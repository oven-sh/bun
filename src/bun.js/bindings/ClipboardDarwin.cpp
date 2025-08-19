#include "root.h"

#if OS(DARWIN)

#include "Clipboard.h"
#include <dlfcn.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <wtf/NeverDestroyed.h>
#include <thread>
#include <CoreFoundation/CoreFoundation.h>

namespace Bun {
namespace Clipboard {

using namespace WTF;

// AppKit C API function pointers loaded dynamically
struct AppKitAPI {
    void* appkit_handle;
    void* foundation_handle;
    
    // Function pointers for NSPasteboard C API
    void* (*NSPasteboardGeneralPasteboard)(void);
    int (*NSPasteboardClearContents)(void* pasteboard);
    int (*NSPasteboardSetStringForType)(void* pasteboard, CFStringRef string, CFStringRef type);
    int (*NSPasteboardSetDataForType)(void* pasteboard, CFDataRef data, CFStringRef type);
    CFStringRef (*NSPasteboardStringForType)(void* pasteboard, CFStringRef type);
    CFDataRef (*NSPasteboardDataForType)(void* pasteboard, CFStringRef type);
    
    // Type constants
    CFStringRef NSPasteboardTypeString;
    CFStringRef NSPasteboardTypeHTML;
    CFStringRef NSPasteboardTypeRTF;
    CFStringRef NSPasteboardTypePNG;
    CFStringRef NSPasteboardTypeTIFF;
    
    bool loaded;
    
    AppKitAPI() : appkit_handle(nullptr), foundation_handle(nullptr), loaded(false) {}
    
    bool load() {
        if (loaded) return true;
        
        // Load Foundation framework
        foundation_handle = dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", RTLD_LAZY);
        if (!foundation_handle) {
            return false;
        }
        
        // Load AppKit framework
        appkit_handle = dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", RTLD_LAZY);
        if (!appkit_handle) {
            dlclose(foundation_handle);
            foundation_handle = nullptr;
            return false;
        }
        
        // Load NSPasteboard C functions
        NSPasteboardGeneralPasteboard = (void*(*)(void))dlsym(appkit_handle, "NSPasteboardGeneralPasteboard");
        NSPasteboardClearContents = (int(*)(void*))dlsym(appkit_handle, "NSPasteboardClearContents");
        NSPasteboardSetStringForType = (int(*)(void*, CFStringRef, CFStringRef))dlsym(appkit_handle, "NSPasteboardSetStringForType");
        NSPasteboardSetDataForType = (int(*)(void*, CFDataRef, CFStringRef))dlsym(appkit_handle, "NSPasteboardSetDataForType");
        NSPasteboardStringForType = (CFStringRef(*)(void*, CFStringRef))dlsym(appkit_handle, "NSPasteboardStringForType");
        NSPasteboardDataForType = (CFDataRef(*)(void*, CFStringRef))dlsym(appkit_handle, "NSPasteboardDataForType");
        
        // Verify we got the essential functions
        if (!NSPasteboardGeneralPasteboard || !NSPasteboardClearContents || 
            !NSPasteboardSetStringForType || !NSPasteboardStringForType) {
            dlclose(appkit_handle);
            dlclose(foundation_handle);
            appkit_handle = nullptr;
            foundation_handle = nullptr;
            return false;
        }
        
        // Load type constants
        void* ptr;
        ptr = dlsym(appkit_handle, "NSPasteboardTypeString");
        if (ptr) NSPasteboardTypeString = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeHTML");
        if (ptr) NSPasteboardTypeHTML = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeRTF");
        if (ptr) NSPasteboardTypeRTF = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypePNG");
        if (ptr) NSPasteboardTypePNG = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeTIFF");
        if (ptr) NSPasteboardTypeTIFF = *(CFStringRef*)ptr;
        
        // Verify we have at least the string type
        if (!NSPasteboardTypeString) {
            dlclose(appkit_handle);
            dlclose(foundation_handle);
            appkit_handle = nullptr;
            foundation_handle = nullptr;
            return false;
        }
        
        loaded = true;
        return true;
    }
    
    ~AppKitAPI() {
        if (appkit_handle) dlclose(appkit_handle);
        if (foundation_handle) dlclose(foundation_handle);
    }
};

static AppKitAPI* getAppKitAPI() {
    static LazyNeverDestroyed<AppKitAPI> api;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        api.construct();
        api->load();
    });
    return api->loaded ? &api.get() : nullptr;
}

static void updateError(Error& err, const String& message) {
    err.type = ErrorType::PlatformError;
    err.message = message;
    err.code = -1;
}

static CFStringRef createCFString(const String& str) {
    auto utf8 = str.utf8();
    return CFStringCreateWithBytes(kCFAllocatorDefault, 
                                  reinterpret_cast<const UInt8*>(utf8.data()), 
                                  utf8.length(), 
                                  kCFStringEncodingUTF8, 
                                  false);
}

static String cfStringToWTFString(CFStringRef cfStr) {
    if (!cfStr) return String();
    
    CFIndex length = CFStringGetLength(cfStr);
    CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    
    Vector<char> buffer(maxSize);
    if (CFStringGetCString(cfStr, buffer.data(), maxSize, kCFStringEncodingUTF8)) {
        return String::fromUTF8(buffer.data());
    }
    return String();
}

// Public API implementations
Error writeText(const String& text) {
    Error err;
    auto* api = getAppKitAPI();
    
    if (!api) {
        updateError(err, "AppKit framework not available"_s);
        return err;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(err, "Could not access pasteboard"_s);
        return err;
    }
    
    CFStringRef cfText = createCFString(text);
    if (!cfText) {
        updateError(err, "Failed to create CFString"_s);
        return err;
    }
    
    api->NSPasteboardClearContents(pasteboard);
    int success = api->NSPasteboardSetStringForType(pasteboard, cfText, api->NSPasteboardTypeString);
    
    CFRelease(cfText);
    
    if (!success) {
        updateError(err, "Failed to write text to pasteboard"_s);
    }
    
    return err;
}

Error writeHTML(const String& html) {
    Error err;
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardTypeHTML || !api->NSPasteboardSetStringForType) {
        // Fall back to writing as plain text
        return writeText(html);
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(err, "Could not access pasteboard"_s);
        return err;
    }
    
    CFStringRef cfHtml = createCFString(html);
    if (!cfHtml) {
        updateError(err, "Failed to create CFString"_s);
        return err;
    }
    
    api->NSPasteboardClearContents(pasteboard);
    int success = api->NSPasteboardSetStringForType(pasteboard, cfHtml, api->NSPasteboardTypeHTML);
    
    CFRelease(cfHtml);
    
    if (!success) {
        updateError(err, "Failed to write HTML to pasteboard"_s);
    }
    
    return err;
}

Error writeRTF(const String& rtf) {
    Error err;
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardTypeRTF || !api->NSPasteboardSetDataForType) {
        // Fall back to writing as plain text
        return writeText(rtf);
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(err, "Could not access pasteboard"_s);
        return err;
    }
    
    auto rtfData = rtf.utf8();
    CFDataRef cfData = CFDataCreate(kCFAllocatorDefault, 
                                   reinterpret_cast<const UInt8*>(rtfData.data()), 
                                   rtfData.length());
    if (!cfData) {
        updateError(err, "Failed to create CFData"_s);
        return err;
    }
    
    api->NSPasteboardClearContents(pasteboard);
    int success = api->NSPasteboardSetDataForType(pasteboard, cfData, api->NSPasteboardTypeRTF);
    
    CFRelease(cfData);
    
    if (!success) {
        updateError(err, "Failed to write RTF to pasteboard"_s);
    }
    
    return err;
}

Error writeImage(const Vector<uint8_t>& imageData, const String& mimeType) {
    Error err;
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardSetDataForType) {
        updateError(err, "Image clipboard operations not supported"_s);
        return err;
    }
    
    // Choose appropriate pasteboard type
    CFStringRef pasteboardType = nullptr;
    if (mimeType == "image/png"_s && api->NSPasteboardTypePNG) {
        pasteboardType = api->NSPasteboardTypePNG;
    } else if (mimeType == "image/tiff"_s && api->NSPasteboardTypeTIFF) {
        pasteboardType = api->NSPasteboardTypeTIFF;
    }
    
    if (!pasteboardType) {
        updateError(err, "Unsupported image format for clipboard"_s);
        return err;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(err, "Could not access pasteboard"_s);
        return err;
    }
    
    CFDataRef cfData = CFDataCreate(kCFAllocatorDefault, imageData.data(), imageData.size());
    if (!cfData) {
        updateError(err, "Failed to create CFData"_s);
        return err;
    }
    
    api->NSPasteboardClearContents(pasteboard);
    int success = api->NSPasteboardSetDataForType(pasteboard, cfData, pasteboardType);
    
    CFRelease(cfData);
    
    if (!success) {
        updateError(err, "Failed to write image to pasteboard"_s);
    }
    
    return err;
}

std::optional<String> readText(Error& error) {
    error = Error{};
    auto* api = getAppKitAPI();
    
    if (!api) {
        updateError(error, "AppKit framework not available"_s);
        return std::nullopt;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(error, "Could not access pasteboard"_s);
        return std::nullopt;
    }
    
    CFStringRef cfText = api->NSPasteboardStringForType(pasteboard, api->NSPasteboardTypeString);
    if (!cfText) {
        updateError(error, "No text found in pasteboard"_s);
        return std::nullopt;
    }
    
    String result = cfStringToWTFString(cfText);
    return result;
}

std::optional<String> readHTML(Error& error) {
    error = Error{};
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardTypeHTML) {
        // Fall back to reading as plain text
        return readText(error);
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(error, "Could not access pasteboard"_s);
        return std::nullopt;
    }
    
    CFStringRef cfHtml = api->NSPasteboardStringForType(pasteboard, api->NSPasteboardTypeHTML);
    if (!cfHtml) {
        // Fall back to reading as plain text
        return readText(error);
    }
    
    String result = cfStringToWTFString(cfHtml);
    return result;
}

std::optional<String> readRTF(Error& error) {
    error = Error{};
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardTypeRTF || !api->NSPasteboardDataForType) {
        // Fall back to reading as plain text
        return readText(error);
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(error, "Could not access pasteboard"_s);
        return std::nullopt;
    }
    
    CFDataRef cfData = api->NSPasteboardDataForType(pasteboard, api->NSPasteboardTypeRTF);
    if (!cfData) {
        // Fall back to reading as plain text
        return readText(error);
    }
    
    const UInt8* bytes = CFDataGetBytePtr(cfData);
    CFIndex length = CFDataGetLength(cfData);
    
    if (!bytes || !length) {
        updateError(error, "Invalid RTF data"_s);
        return std::nullopt;
    }
    
    return String::fromUTF8(std::span<const char>(reinterpret_cast<const char*>(bytes), length));
}

std::optional<Vector<uint8_t>> readImage(Error& error, String& mimeType) {
    error = Error{};
    auto* api = getAppKitAPI();
    
    if (!api || !api->NSPasteboardDataForType) {
        updateError(error, "Image clipboard operations not supported"_s);
        return std::nullopt;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(error, "Could not access pasteboard"_s);
        return std::nullopt;
    }
    
    CFDataRef imageData = nullptr;
    
    // Try PNG first
    if (api->NSPasteboardTypePNG) {
        imageData = api->NSPasteboardDataForType(pasteboard, api->NSPasteboardTypePNG);
        if (imageData) {
            mimeType = "image/png"_s;
        }
    }
    
    // Try TIFF if PNG not available
    if (!imageData && api->NSPasteboardTypeTIFF) {
        imageData = api->NSPasteboardDataForType(pasteboard, api->NSPasteboardTypeTIFF);
        if (imageData) {
            mimeType = "image/tiff"_s;
        }
    }
    
    if (!imageData) {
        updateError(error, "No image found in pasteboard"_s);
        return std::nullopt;
    }
    
    const UInt8* bytes = CFDataGetBytePtr(imageData);
    CFIndex length = CFDataGetLength(imageData);
    
    if (!bytes || !length) {
        updateError(error, "Invalid image data"_s);
        return std::nullopt;
    }
    
    Vector<uint8_t> result;
    result.append(std::span<const uint8_t>(bytes, length));
    return result;
}

bool isSupported() {
    return getAppKitAPI() != nullptr;
}

Vector<DataType> getSupportedTypes() {
    Vector<DataType> types;
    auto* api = getAppKitAPI();
    if (api) {
        types.append(DataType::Text);
        if (api->NSPasteboardTypeHTML) types.append(DataType::HTML);
        if (api->NSPasteboardTypeRTF) types.append(DataType::RTF);
        if (api->NSPasteboardTypePNG || api->NSPasteboardTypeTIFF) types.append(DataType::Image);
    }
    return types;
}

// Async implementations using std::thread
void writeTextAsync(const String& text, WriteCallback callback) {
    std::thread([text = text.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeText(text);
        callback(error);
    }).detach();
}

void writeHTMLAsync(const String& html, WriteCallback callback) {
    std::thread([html = html.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeHTML(html);
        callback(error);
    }).detach();
}

void writeRTFAsync(const String& rtf, WriteCallback callback) {
    std::thread([rtf = rtf.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeRTF(rtf);
        callback(error);
    }).detach();
}

void writeImageAsync(const Vector<uint8_t>& imageData, const String& mimeType, WriteCallback callback) {
    std::thread([imageData, mimeType = mimeType.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeImage(imageData, mimeType);
        callback(error);
    }).detach();
}

void readTextAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto text = readText(error);
        Vector<ClipboardData> data;
        
        if (text.has_value() && !text->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::Text;
            clipData.mimeType = "text/plain"_s;
            auto textUtf8 = text->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(textUtf8.data()), textUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readHTMLAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto html = readHTML(error);
        Vector<ClipboardData> data;
        
        if (html.has_value() && !html->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::HTML;
            clipData.mimeType = "text/html"_s;
            auto htmlUtf8 = html->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(htmlUtf8.data()), htmlUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readRTFAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto rtf = readRTF(error);
        Vector<ClipboardData> data;
        
        if (rtf.has_value() && !rtf->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::RTF;
            clipData.mimeType = "text/rtf"_s;
            auto rtfUtf8 = rtf->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(rtfUtf8.data()), rtfUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readImageAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        String mimeType;
        auto imageData = readImage(error, mimeType);
        Vector<ClipboardData> data;
        
        if (imageData.has_value()) {
            ClipboardData clipData;
            clipData.type = DataType::Image;
            clipData.mimeType = mimeType;
            clipData.data = WTFMove(*imageData);
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

} // namespace Clipboard
} // namespace Bun

#endif // OS(DARWIN)