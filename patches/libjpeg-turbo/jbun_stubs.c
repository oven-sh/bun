/* libjpeg-turbo's master_selection() in jcmaster.c/jdmaster.c dispatches at
 * RUNTIME on cinfo->data_precision and calls j12init_* / j16init_* directly,
 * with no compile-time gate. Upstream satisfies those by recompiling a subset
 * of sources twice more with -DBITS_IN_JSAMPLE=12/16; we only ship 8-bit, so
 * provide ERREXIT stubs instead and avoid ~60 extra TUs. The branches that
 * reach these are already preceded by a precision check that ERREXITs for
 * anything Bun.Image would feed in, so these stubs are belt-and-braces.
 *
 * tj3LoadImage8/tj3SaveImage8 are gated out by 8bit-only.patch but the legacy
 * v2 tjLoadImage/tjSaveImage shims still reference them; stub those too.
 */

#define JPEG_INTERNALS
#include "jinclude.h"
#include "jpeglib.h"
#include "jerror.h"

#define DIE_C(name) \
  void name(j_compress_ptr cinfo) { ERREXIT1(cinfo, JERR_BAD_PRECISION, cinfo->data_precision); }
#define DIE_C2(name) \
  void name(j_compress_ptr cinfo, boolean b) { (void)b; ERREXIT1(cinfo, JERR_BAD_PRECISION, cinfo->data_precision); }
#define DIE_D(name) \
  void name(j_decompress_ptr cinfo) { ERREXIT1(cinfo, JERR_BAD_PRECISION, cinfo->data_precision); }
#define DIE_D2(name) \
  void name(j_decompress_ptr cinfo, boolean b) { (void)b; ERREXIT1(cinfo, JERR_BAD_PRECISION, cinfo->data_precision); }

DIE_C2(j12init_c_coef_controller)
DIE_C2(j12init_c_diff_controller)
DIE_C2(j12init_c_main_controller)
DIE_C2(j12init_c_prep_controller)
DIE_C(j12init_color_converter)
DIE_C(j12init_downsampler)
DIE_C(j12init_forward_dct)
DIE_C(j12init_lossless_compressor)
DIE_C2(j16init_c_diff_controller)
DIE_C2(j16init_c_main_controller)
DIE_C2(j16init_c_prep_controller)
DIE_C(j16init_color_converter)
DIE_C(j16init_downsampler)
DIE_C(j16init_lossless_compressor)

DIE_D(j12init_color_deconverter)
DIE_D2(j12init_d_coef_controller)
DIE_D2(j12init_d_diff_controller)
DIE_D2(j12init_d_main_controller)
DIE_D2(j12init_d_post_controller)
DIE_D(j12init_inverse_dct)
DIE_D(j12init_lossless_decompressor)
DIE_D(j12init_merged_upsampler)
DIE_D(j12init_upsampler)
DIE_D(j12init_1pass_quantizer)
DIE_D(j12init_2pass_quantizer)
DIE_D(j16init_color_deconverter)
DIE_D2(j16init_d_diff_controller)
DIE_D2(j16init_d_main_controller)
DIE_D2(j16init_d_post_controller)
DIE_D(j16init_lossless_decompressor)
DIE_D(j16init_merged_upsampler)
DIE_D(j16init_upsampler)

unsigned char *tj3LoadImage8(void *h, const char *f, int *w, int a, int *ht, int *pf)
{ (void)h; (void)f; (void)w; (void)a; (void)ht; (void)pf; return 0; }
int tj3SaveImage8(void *h, const char *f, const unsigned char *b, int w, int p, int ht, int pf)
{ (void)h; (void)f; (void)b; (void)w; (void)p; (void)ht; (void)pf; return -1; }
