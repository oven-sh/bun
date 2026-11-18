#include <metal_stdlib>
using namespace metal;

// What `Band::paint` in `software.rs` does.

struct Instance {
    float4 bounds;
    float4 area;
    float4 radii;
    float4 border;
    int4 part;
    uint color;
    uint border_color;
    uint kind;
    uint slot;
    uint offset;
    uint width;
    uint height;
    float opacity;
    float4 smoothing;
};

struct Varyings {
    float4 position [[position]];
    uint instance [[flat]];
};

vertex Varyings place(uint corner [[vertex_id]], uint instance [[instance_id]],
                      const device Instance *instances [[buffer(0)]], constant float4 &cell [[buffer(1)]]) {
    float4 area = instances[instance].area;
    float x = (corner & 1) != 0 ? area.z : area.x;
    float y = (corner & 2) != 0 ? area.w : area.y;
    Varyings out;
    out.position = float4((x - cell.x) / cell.z * 2.0f - 1.0f, 1.0f - (y - cell.y) / cell.w * 2.0f, 0.0f, 1.0f);
    out.instance = instance;
    return out;
}

static float4 rgba(uint bgra) {
    return unpack_unorm4x8_to_float(bgra).zyxw;
}

static float smooth_distance(float2 from_corner, float radius, float2 smoothings) {
    bool is_across = from_corner.x <= from_corner.y;
    float along = is_across ? -from_corner.x : -from_corner.y;
    float depth = is_across ? -from_corner.y : -from_corner.x;
    float smoothing = is_across ? smoothings.x : smoothings.y;
    float left = radius * (1.0f + smoothing) - along;
    if (left <= 0.0f || depth >= radius || radius <= 0.0f) {
        return -depth;
    }
    float sine = sin(smoothing * 0.78539816f);
    float cosine = cos(smoothing * 0.78539816f);
    float u = radius - along;
    float v = radius - depth;
    if (u * cosine >= v * sine) {
        return length(float2(u, v)) - radius;
    }
    float first = radius * (smoothing + sine / (1.0f + cosine));
    float rest = radius * sine * cosine / (1.0f + cosine);
    float rise = radius * (1.0f - cosine);
    float t = 1.0f - sqrt(fmax(1.0f - left / (first + rest), 0.0f));
    for (int step = 0; step < 2; step++) {
        t = saturate(t + (left - first * t * (2.0f - t) - rest * t * t * t) / (2.0f * first * (1.0f - t) + 3.0f * rest * t * t));
    }
    float slope = 3.0f * rise * t * t / (2.0f * first * (1.0f - t) + 3.0f * rest * t * t);
    return (rise * t * t * t + (left - first * t * (2.0f - t) - rest * t * t * t) * slope - depth) / sqrt(1.0f + slope * slope);
}

static float2 smoothing_of_corner(float2 size, float4 radii, float smoothing, bool is_left, bool is_top) {
    float across = is_top ? radii.x + radii.y : radii.z + radii.w;
    float down = is_left ? radii.w + radii.x : radii.y + radii.z;
    return float2(clamp(size.x / fmax(across, 1e-6f) - 1.0f, 0.0f, smoothing), clamp(size.y / fmax(down, 1e-6f) - 1.0f, 0.0f, smoothing));
}

static float2 coverage(const device Instance &it, float2 at) {
    float2 half_size = it.bounds.zw / 2.0f;
    float2 from_center = at - it.bounds.xy - half_size;
    float2 from_corner = fabs(from_center) - half_size;
    bool is_left = from_center.x < 0.0f;
    bool is_top = from_center.y < 0.0f;
    float radius = is_top ? (is_left ? it.radii.x : it.radii.y) : (is_left ? it.radii.w : it.radii.z);
    float across = is_left ? it.border.w : it.border.y;
    float down = is_top ? it.border.x : it.border.z;
    float2 border = float2(across == 0.0f ? -0.5f : across, down == 0.0f ? -0.5f : down);
    float2 uv = from_corner + radius;
    float2 from_inner_corner = from_corner + border;
    if (it.smoothing.x > 0.0f) {
        float4 sides = it.border;
        float4 inner_radii = float4(fmax(it.radii.x - fmax(sides.x, sides.w), 0.0f), fmax(it.radii.y - fmax(sides.x, sides.y), 0.0f),
                                    fmax(it.radii.z - fmax(sides.z, sides.y), 0.0f), fmax(it.radii.w - fmax(sides.z, sides.w), 0.0f));
        float2 inner_size = it.bounds.zw - float2(sides.w + sides.y, sides.x + sides.z);
        float2 of_outer = smoothing_of_corner(it.bounds.zw, it.radii, it.smoothing.x, is_left, is_top);
        float2 of_inner = smoothing_of_corner(inner_size, inner_radii, it.smoothing.x, is_left, is_top);
        float inside = smooth_distance(from_inner_corner, radius - fmax(border.x, border.y), of_inner);
        return float2(saturate(0.5f - smooth_distance(from_corner, radius, of_outer)), saturate(0.5f + inside));
    }
    float outer = length(float2(fmax(uv.x, 0.0f), fmax(uv.y, 0.0f))) + fmin(fmax(uv.x, uv.y), 0.0f) - radius;
    float inner;
    if (uv.x <= 0.0f || uv.y <= 0.0f) {
        inner = -fmax(from_inner_corner.x, from_inner_corner.y);
    } else if (from_inner_corner.x > 0.0f || from_inner_corner.y > 0.0f) {
        inner = -1.0f;
    } else if (border.x == border.y) {
        inner = -(outer + border.x);
    } else {
        float2 radii = float2(fmax(radius - border.x, 1e-6f), fmax(radius - border.y, 1e-6f));
        inner = (length(uv / radii) - 1.0f) * (radii.x + radii.y) * -0.5f;
    }
    return float2(saturate(0.5f - outer), saturate(0.5f - inner));
}

struct Between {
    uint before;
    uint after;
    float fraction;
};

static Between between(float pixel, int first, int texels, uint limit, float start, float extent) {
    if (texels == 1) {
        return Between{uint(first), uint(first), 0.0f};
    }
    float position = float(first) + (pixel - start) * (float(texels) / extent) - 0.5f;
    float before = floor(position);
    float last = float(limit - 1);
    return Between{uint(clamp(before, 0.0f, last)), uint(clamp(before + 1.0f, 0.0f, last)), position - before};
}

fragment float4 paint(Varyings in [[stage_in]],
                      const device Instance *instances [[buffer(0)]], constant float4 &cell [[buffer(1)]],
                      const device uchar *slot0 [[buffer(2)]], const device uchar *slot1 [[buffer(3)]],
                      const device uchar *slot2 [[buffer(4)]], const device uchar *slot3 [[buffer(5)]],
                      const device uchar *slot4 [[buffer(6)]], const device uchar *slot5 [[buffer(7)]],
                      const device uchar *slot6 [[buffer(8)]], const device uchar *slot7 [[buffer(9)]]) {
    const device Instance &it = instances[in.instance];
    float2 at = in.position.xy + cell.xy;
    if (it.kind == 0) {
        return rgba(it.color);
    }
    if (it.kind == 1) {
        float2 covered = coverage(it, at);
        float4 border = rgba(it.border_color) * covered.y;
        return (border + rgba(it.color) * (1.0f - border.w)) * covered.x;
    }
    uint slot = it.slot;
    const device uchar *bytes = slot < 4 ? (slot < 2 ? (slot == 0 ? slot0 : slot1) : (slot == 2 ? slot2 : slot3))
                                         : (slot < 6 ? (slot == 4 ? slot4 : slot5) : (slot == 6 ? slot6 : slot7));
    bytes += it.offset;
    if (it.kind == 2) {
        uint x = min(uint(int(at.x) - int(it.bounds.x)), it.width - 1);
        uint y = min(uint(int(at.y) - int(it.bounds.y)), it.height - 1);
        return rgba(it.color) * (float(bytes[y * it.width + x]) / 255.0f);
    }
    const device uint *texels = (const device uint *)bytes;
    Between x = between(at.x, it.part.x, it.part.z, it.width, it.bounds.x, it.bounds.z);
    Between y = between(at.y, it.part.y, it.part.w, it.height, it.bounds.y, it.bounds.w);
    float4 color = rgba(texels[y.before * it.width + x.before]);
    if (x.fraction > 0.002f || y.fraction > 0.002f) {
        float4 above = mix(color, rgba(texels[y.before * it.width + x.after]), x.fraction);
        float4 below = mix(rgba(texels[y.after * it.width + x.before]), rgba(texels[y.after * it.width + x.after]), x.fraction);
        color = mix(above, below, y.fraction);
    }
    return color * (it.kind == 4 ? it.opacity * coverage(it, at).x : it.opacity);
}
