// X11-backed native window enumeration and capture, isolated in its own
// translation unit because <X11/Xlib.h> defines macros (None, Success, Bool,
// Status, ...) that collide with CEF/Chromium headers. Exposes only the
// CEF-free C ABI declared in shim.h. Non-Linux builds get NULL stubs.

#include "shim.h"

#include <cstdlib>
#include <cstring>
#include <string>

#if defined(__linux__)
#include <X11/Xlib.h>
#include <X11/Xutil.h>

namespace {

char* DupString(const std::string& s) {
  char* out = static_cast<char*>(malloc(s.size() + 1));
  memcpy(out, s.c_str(), s.size() + 1);
  return out;
}

void JsonEscape(std::string& out, const std::string& s) {
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
}

const char kB64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string Base64(const unsigned char* data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < len; i += 3) {
    uint32_t n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out.push_back(kB64[(n >> 18) & 63]);
    out.push_back(kB64[(n >> 12) & 63]);
    out.push_back(kB64[(n >> 6) & 63]);
    out.push_back(kB64[n & 63]);
  }
  if (i < len) {
    uint32_t n = data[i] << 16;
    if (i + 1 < len) n |= data[i + 1] << 8;
    out.push_back(kB64[(n >> 18) & 63]);
    out.push_back(kB64[(n >> 12) & 63]);
    out.push_back(i + 1 < len ? kB64[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

// Suppress X errors (e.g. BadMatch from XGetImage on unusual windows) so they
// don't abort the process; we detect failures via return values instead.
int g_x_error = 0;
int IgnoreXError(Display*, XErrorEvent*) {
  g_x_error = 1;
  return 0;
}

int CountBits(unsigned long mask) {
  int n = 0;
  while (mask) {
    n += mask & 1;
    mask >>= 1;
  }
  return n;
}

int LowBit(unsigned long mask) {
  int shift = 0;
  if (!mask) return 0;
  while (!(mask & 1)) {
    mask >>= 1;
    shift++;
  }
  return shift;
}

std::string WindowTitle(Display* dpy, Window w) {
  // Prefer _NET_WM_NAME (UTF-8), fall back to WM_NAME.
  Atom netName = XInternAtom(dpy, "_NET_WM_NAME", True);
  Atom utf8 = XInternAtom(dpy, "UTF8_STRING", True);
  if (netName != None && utf8 != None) {
    Atom type;
    int format;
    unsigned long nitems, after;
    unsigned char* data = nullptr;
    if (XGetWindowProperty(dpy, w, netName, 0, 1024, False, utf8, &type, &format,
                           &nitems, &after, &data) == Success &&
        data) {
      std::string s(reinterpret_cast<char*>(data), nitems);
      XFree(data);
      if (!s.empty()) return s;
    }
  }
  char* name = nullptr;
  if (XFetchName(dpy, w, &name) && name) {
    std::string s(name);
    XFree(name);
    return s;
  }
  return "";
}

}  // namespace

extern "C" BE_EXPORT char* be_enumerate_windows(void) {
  Display* dpy = XOpenDisplay(nullptr);
  if (!dpy) return nullptr;
  XSetErrorHandler(IgnoreXError);
  Window root = DefaultRootWindow(dpy);
  Window rootRet, parent;
  Window* children = nullptr;
  unsigned int n = 0;
  std::string out = "[";
  bool first = true;
  if (XQueryTree(dpy, root, &rootRet, &parent, &children, &n) && children) {
    for (unsigned int i = 0; i < n; i++) {
      XWindowAttributes attr;
      if (!XGetWindowAttributes(dpy, children[i], &attr)) continue;
      if (attr.map_state != IsViewable) continue;
      if (attr.c_class != InputOutput) continue;
      if (attr.width < 2 || attr.height < 2) continue;
      std::string title = WindowTitle(dpy, children[i]);
      if (!first) out += ',';
      first = false;
      out += "{\"xid\":";
      out += std::to_string(static_cast<unsigned long>(children[i]));
      out += ",\"title\":\"";
      JsonEscape(out, title);
      out += "\",\"width\":";
      out += std::to_string(attr.width);
      out += ",\"height\":";
      out += std::to_string(attr.height);
      out += "}";
    }
    if (children) XFree(children);
  }
  out += "]";
  XCloseDisplay(dpy);
  return DupString(out);
}

extern "C" BE_EXPORT char* be_capture_window(uint32_t xid) {
  Display* dpy = XOpenDisplay(nullptr);
  if (!dpy) return nullptr;
  XSetErrorHandler(IgnoreXError);
  g_x_error = 0;
  Window w = static_cast<Window>(xid);
  XWindowAttributes attr;
  if (!XGetWindowAttributes(dpy, w, &attr) || g_x_error) {
    XCloseDisplay(dpy);
    return nullptr;
  }
  const int width = attr.width;
  const int height = attr.height;
  XImage* img = XGetImage(dpy, w, 0, 0, width, height, AllPlanes, ZPixmap);
  if (!img || g_x_error) {
    if (img) XDestroyImage(img);
    XCloseDisplay(dpy);
    return nullptr;
  }

  const int rShift = LowBit(img->red_mask);
  const int gShift = LowBit(img->green_mask);
  const int bShift = LowBit(img->blue_mask);
  const int rBits = CountBits(img->red_mask);
  const int gBits = CountBits(img->green_mask);
  const int bBits = CountBits(img->blue_mask);
  auto scale = [](unsigned long v, int bits) -> unsigned char {
    if (bits <= 0) return 0;
    if (bits >= 8) return static_cast<unsigned char>((v >> (bits - 8)) & 0xff);
    return static_cast<unsigned char>((v << (8 - bits)) & 0xff);
  };

  std::string rgba;
  rgba.resize(static_cast<size_t>(width) * height * 4);
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      unsigned long px = XGetPixel(img, x, y);
      size_t di = (static_cast<size_t>(y) * width + x) * 4;
      rgba[di] = scale((px & img->red_mask) >> rShift, rBits);
      rgba[di + 1] = scale((px & img->green_mask) >> gShift, gBits);
      rgba[di + 2] = scale((px & img->blue_mask) >> bShift, bBits);
      rgba[di + 3] = static_cast<char>(0xff);
    }
  }
  XDestroyImage(img);
  XCloseDisplay(dpy);

  std::string b64 = Base64(reinterpret_cast<const unsigned char*>(rgba.data()),
                           rgba.size());
  std::string out = "{\"width\":" + std::to_string(width) +
                    ",\"height\":" + std::to_string(height) + ",\"data\":\"" +
                    b64 + "\"}";
  return DupString(out);
}

#else  // non-Linux

extern "C" BE_EXPORT char* be_enumerate_windows(void) {
  return nullptr;
}
extern "C" BE_EXPORT char* be_capture_window(uint32_t) {
  return nullptr;
}

#endif
