// Flat C entry point for Bun.Image's `.jxl()`, so the Rust side declares one
// function instead of mirroring JxlBasicInfo (25 fields + 100 bytes of
// padding whose layout would only fail at runtime).
//
// Input is always 8-bit straight-alpha RGBA (codec_jxl.rs). The output buffer
// is malloc'd here and released by the caller with free().

#include <jxl/color_encoding.h>
#include <jxl/encode.h>
#include <jxl/types.h>

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

namespace {
struct EncoderDeleter {
  JxlEncoder* enc;
  ~EncoderDeleter() { JxlEncoderDestroy(enc); }
};
}  // namespace

// Returns 0 on success, 1 on encoder error, 2 on allocation failure.
extern "C" int bun_jxl_encode(const uint8_t* rgba, uint32_t width,
                              uint32_t height, float distance, int lossless,
                              const uint8_t* icc, size_t icc_len,
                              uint8_t** out, size_t* out_len) {
  *out = nullptr;
  *out_len = 0;
  JxlEncoder* enc = JxlEncoderCreate(nullptr);
  if (!enc) return 2;
  EncoderDeleter guard{enc};

  JxlBasicInfo info;
  JxlEncoderInitBasicInfo(&info);
  info.xsize = width;
  info.ysize = height;
  info.bits_per_sample = 8;
  info.num_color_channels = 3;
  info.num_extra_channels = 1;
  info.alpha_bits = 8;
  // Lossless can't go through XYB; libjxl rejects the frame otherwise.
  info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
  if (JxlEncoderSetBasicInfo(enc, &info) != JXL_ENC_SUCCESS) return 1;

  if (icc && icc_len) {
    if (JxlEncoderSetICCProfile(enc, icc, icc_len) != JXL_ENC_SUCCESS) return 1;
  } else {
    JxlColorEncoding srgb;
    JxlColorEncodingSetToSRGB(&srgb, JXL_FALSE);
    if (JxlEncoderSetColorEncoding(enc, &srgb) != JXL_ENC_SUCCESS) return 1;
  }

  JxlEncoderFrameSettings* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
  if (!settings) return 2;
  if (lossless) {
    if (JxlEncoderSetFrameLossless(settings, JXL_TRUE) != JXL_ENC_SUCCESS) return 1;
  } else if (JxlEncoderSetFrameDistance(settings, distance) != JXL_ENC_SUCCESS) {
    return 1;
  }

  const JxlPixelFormat format = {4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  const size_t size = static_cast<size_t>(width) * height * 4;
  if (JxlEncoderAddImageFrame(settings, &format, rgba, size) != JXL_ENC_SUCCESS) return 1;
  JxlEncoderCloseInput(enc);

  size_t cap = size / 8 + 4096;
  uint8_t* buf = static_cast<uint8_t*>(malloc(cap));
  if (!buf) return 2;
  uint8_t* next = buf;
  size_t avail = cap;
  for (;;) {
    JxlEncoderStatus status = JxlEncoderProcessOutput(enc, &next, &avail);
    if (status == JXL_ENC_SUCCESS) break;
    if (status != JXL_ENC_NEED_MORE_OUTPUT) {
      free(buf);
      return 1;
    }
    size_t used = static_cast<size_t>(next - buf);
    cap *= 2;
    uint8_t* grown = static_cast<uint8_t*>(realloc(buf, cap));
    if (!grown) {
      free(buf);
      return 2;
    }
    buf = grown;
    next = buf + used;
    avail = cap - used;
  }
  *out = buf;
  *out_len = static_cast<size_t>(next - buf);
  return 0;
}
