/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_types_DEFINED
#define sk_types_DEFINED

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
    #define SK_C_PLUS_PLUS_BEGIN_GUARD    extern "C" {
    #define SK_C_PLUS_PLUS_END_GUARD      }
#else
    #include <stdbool.h>
    #define SK_C_PLUS_PLUS_BEGIN_GUARD
    #define SK_C_PLUS_PLUS_END_GUARD
#endif

#if !defined(SK_API)
    #if defined(SKIA_DLL)
        #if defined(_MSC_VER)
            #if SKIA_IMPLEMENTATION
                #define SK_API __declspec(dllexport)
            #else
                #define SK_API __declspec(dllimport)
            #endif
        #else
            #define SK_API __attribute__((visibility("default")))
        #endif
    #else
        #define SK_API
    #endif
#endif

///////////////////////////////////////////////////////////////////////////////////////

SK_C_PLUS_PLUS_BEGIN_GUARD

typedef uint32_t sk_color_t;

/* This macro assumes all arguments are >=0 and <=255. */
#define sk_color_set_argb(a, r, g, b)   (((a) << 24) | ((r) << 16) | ((g) << 8) | (b))
#define sk_color_get_a(c)               (((c) >> 24) & 0xFF)
#define sk_color_get_r(c)               (((c) >> 16) & 0xFF)
#define sk_color_get_g(c)               (((c) >>  8) & 0xFF)
#define sk_color_get_b(c)               (((c) >>  0) & 0xFF)

typedef enum {
    INTERSECT_SK_CLIPTYPE,
    DIFFERENCE_SK_CLIPTYPE,
} sk_cliptype_t;

typedef enum {
    UNKNOWN_SK_PIXELGEOMETRY,
    RGB_H_SK_PIXELGEOMETRY,
    BGR_H_SK_PIXELGEOMETRY,
    RGB_V_SK_PIXELGEOMETRY,
    BGR_V_SK_PIXELGEOMETRY,
} sk_pixelgeometry_t;

typedef struct {
    sk_pixelgeometry_t pixelGeometry;
} sk_surfaceprops_t;

typedef struct {
    float   x;
    float   y;
} sk_point_t;

typedef struct {
    int32_t left;
    int32_t top;
    int32_t right;
    int32_t bottom;
} sk_irect_t;

typedef struct {
    float   left;
    float   top;
    float   right;
    float   bottom;
} sk_rect_t;

/**
    The sk_matrix_t struct holds a 3x3 perspective matrix for
    transforming coordinates:

        (X,Y) = T[M]((x,y))
        X = (M[0] * x + M[1] * y + M[2]) / (M[6] * x + M[7] * y + M[8]);
        Y = (M[3] * x + M[4] * y + M[5]) / (M[6] * x + M[7] * y + M[8]);

    Therefore, the identity matrix is

        sk_matrix_t identity = {{1, 0, 0,
                                 0, 1, 0,
                                 0, 0, 1}};

    A matrix that scales by sx and sy is:

        sk_matrix_t scale = {{sx, 0,  0,
                              0,  sy, 0,
                              0,  0,  1}};

    A matrix that translates by tx and ty is:

        sk_matrix_t translate = {{1, 0, tx,
                                  0, 1, ty,
                                  0, 0, 1}};

    A matrix that rotates around the origin by A radians:

        sk_matrix_t rotate = {{cos(A), -sin(A), 0,
                               sin(A),  cos(A), 0,
                               0,       0,      1}};

    Two matrixes can be concatinated by:

         void concat_matrices(sk_matrix_t* dst,
                             const sk_matrix_t* matrixU,
                             const sk_matrix_t* matrixV) {
            const float* u = matrixU->mat;
            const float* v = matrixV->mat;
            sk_matrix_t result = {{
                    u[0] * v[0] + u[1] * v[3] + u[2] * v[6],
                    u[0] * v[1] + u[1] * v[4] + u[2] * v[7],
                    u[0] * v[2] + u[1] * v[5] + u[2] * v[8],
                    u[3] * v[0] + u[4] * v[3] + u[5] * v[6],
                    u[3] * v[1] + u[4] * v[4] + u[5] * v[7],
                    u[3] * v[2] + u[4] * v[5] + u[5] * v[8],
                    u[6] * v[0] + u[7] * v[3] + u[8] * v[6],
                    u[6] * v[1] + u[7] * v[4] + u[8] * v[7],
                    u[6] * v[2] + u[7] * v[5] + u[8] * v[8]
            }};
            *dst = result;
        }
*/
typedef struct {
    float   mat[9];
} sk_matrix_t;

/**
    A sk_canvas_t encapsulates all of the state about drawing into a
    destination This includes a reference to the destination itself,
    and a stack of matrix/clip values.
*/
typedef struct sk_canvas_t sk_canvas_t;
/**
    A sk_data_ holds an immutable data buffer.
*/
typedef struct sk_data_t sk_data_t;
/**
    A sk_image_t is an abstraction for drawing a rectagle of pixels.
    The content of the image is always immutable, though the actual
    storage may change, if for example that image can be re-created via
    encoded data or other means.
*/
typedef struct sk_image_t sk_image_t;

/**
 *  Describes the color components. See ICC Profiles.
 */
typedef struct sk_colorspace_t sk_colorspace_t;

/**
 *  Describes an image buffer : width, height, pixel type, colorspace, etc.
 */
typedef struct sk_imageinfo_t sk_imageinfo_t;

/**
    A sk_maskfilter_t is an object that perform transformations on an
    alpha-channel mask before drawing it; it may be installed into a
    sk_paint_t.  Each time a primitive is drawn, it is first
    scan-converted into a alpha mask, which os handed to the
    maskfilter, which may create a new mask is to render into the
    destination.
 */
typedef struct sk_maskfilter_t sk_maskfilter_t;
/**
    A sk_paint_t holds the style and color information about how to
    draw geometries, text and bitmaps.
*/
typedef struct sk_paint_t sk_paint_t;
/**
    A sk_path_t encapsulates compound (multiple contour) geometric
    paths consisting of straight line segments, quadratic curves, and
    cubic curves.
*/
typedef struct sk_path_t sk_path_t;
/**
    A sk_picture_t holds recorded canvas drawing commands to be played
    back at a later time.
*/
typedef struct sk_picture_t sk_picture_t;
/**
    A sk_picture_recorder_t holds a sk_canvas_t that records commands
    to create a sk_picture_t.
*/
typedef struct sk_picture_recorder_t sk_picture_recorder_t;
/**
    A sk_shader_t specifies the source color(s) for what is being drawn. If a
    paint has no shader, then the paint's color is used. If the paint
    has a shader, then the shader's color(s) are use instead, but they
    are modulated by the paint's alpha.
*/
typedef struct sk_shader_t sk_shader_t;
/**
    A sk_surface_t holds the destination for drawing to a canvas. For
    raster drawing, the destination is an array of pixels in memory.
    For GPU drawing, the destination is a texture or a framebuffer.
*/
typedef struct sk_surface_t sk_surface_t;

typedef enum {
    NEAREST_SK_FILTER_MODE,
    LINEAR_SK_FILTER_MODE,
} sk_filter_mode_t;

typedef enum {
    NONE_SK_MIPMAP_MODE,
    NEAREST_SK_MIPMAP_MODE,
    LINEAR_SK_MIPMAP_MODE,
} sk_mipmap_mode_t;

typedef struct {
    float B, C;
} sk_cubic_resampler_t;

typedef struct {
    bool useCubic;
    sk_cubic_resampler_t cubic;
    sk_filter_mode_t filter;
    sk_mipmap_mode_t mipmap;
} sk_sampling_options_t;

typedef enum {
    CLEAR_SK_XFERMODE_MODE,
    SRC_SK_XFERMODE_MODE,
    DST_SK_XFERMODE_MODE,
    SRCOVER_SK_XFERMODE_MODE,
    DSTOVER_SK_XFERMODE_MODE,
    SRCIN_SK_XFERMODE_MODE,
    DSTIN_SK_XFERMODE_MODE,
    SRCOUT_SK_XFERMODE_MODE,
    DSTOUT_SK_XFERMODE_MODE,
    SRCATOP_SK_XFERMODE_MODE,
    DSTATOP_SK_XFERMODE_MODE,
    XOR_SK_XFERMODE_MODE,
    PLUS_SK_XFERMODE_MODE,
    MODULATE_SK_XFERMODE_MODE,
    SCREEN_SK_XFERMODE_MODE,
    OVERLAY_SK_XFERMODE_MODE,
    DARKEN_SK_XFERMODE_MODE,
    LIGHTEN_SK_XFERMODE_MODE,
    COLORDODGE_SK_XFERMODE_MODE,
    COLORBURN_SK_XFERMODE_MODE,
    HARDLIGHT_SK_XFERMODE_MODE,
    SOFTLIGHT_SK_XFERMODE_MODE,
    DIFFERENCE_SK_XFERMODE_MODE,
    EXCLUSION_SK_XFERMODE_MODE,
    MULTIPLY_SK_XFERMODE_MODE,
    HUE_SK_XFERMODE_MODE,
    SATURATION_SK_XFERMODE_MODE,
    COLOR_SK_XFERMODE_MODE,
    LUMINOSITY_SK_XFERMODE_MODE,
} sk_xfermode_mode_t;

//////////////////////////////////////////////////////////////////////////////////////////

SK_C_PLUS_PLUS_END_GUARD

#endif
