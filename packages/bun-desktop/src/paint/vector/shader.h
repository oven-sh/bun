// What `vector.rs` describes, in what the shading languages have in common.

struct Corner {
  float2 at;
  float depth;
  uint color;
  uint flags;
  uint address;
  uint stride;
  float2 from_center;
  float2 reach;
  float4 part;
};

struct Curve {
  float2 a;
  float2 b;
  float2 c;
  float2 d;
  bool is_line;
};

struct Space {
  float4 to_pixels;
  float4 from_pixels;
};

FUNCTION float2 times(float4 by, float2 it) {
  return float2(by.x * it.x + by.z * it.y, by.y * it.x + by.w * it.y);
}

FUNCTION int low_half(uint it) { return int(it << 16) >> 16; }

FUNCTION int high_half(uint it) { return int(it) >> 16; }

FUNCTION bool is_zero(float2 it) { return it.x == 0.0 && it.y == 0.0; }

FUNCTION float fraction(float part, float whole) {
  return part >= whole ? 1.0 : part / whole;
}

FUNCTION float2 point_at(Curve it, float t) {
  if (t >= 1.0)
    return it.d;
  if (it.is_line)
    return mix(it.a, it.d, t);
  float2 middle = mix(it.b, it.c, t);
  return mix(mix(mix(it.a, it.b, t), middle, t),
             mix(middle, mix(it.c, it.d, t), t), t);
}

FUNCTION float2 direction_at(Curve it, float t) {
  float2 first = it.b - it.a;
  float2 second = it.c - it.b;
  float2 third = it.d - it.c;
  float2 along = t <= 0.0 ? first
                 : t >= 1.0
                     ? third
                     : mix(mix(first, second, t), mix(second, third, t), t);
  if (is_zero(along))
    along = t < 0.5 ? it.c - it.a : it.d - it.b;
  if (it.is_line || is_zero(along))
    along = it.d - it.a;
  return along;
}

FUNCTION float2 unit(Space space, float2 along) {
  return normalize(times(space.from_pixels, along));
}

FUNCTION float2 left_of(float2 along) { return float2(along.y, -along.x); }

FUNCTION float2 slant(float2 normal) {
  return float2(max(abs(normal.x), abs(normal.y)),
                min(abs(normal.x), abs(normal.y)));
}

// From the pivot, in radii.
FUNCTION float2 join(float2 before, float2 after, uint corner, float step,
                     bool is_round, float2 style, float pixel) {
  float cosine = dot(before, after);
  if (cosine > 0.998)
    return left_of(corner < 2u ? before : after) *
           ((corner & 1u) == 0u ? 1.0 : -1.0);
  float side = before.x * after.y - before.y * after.x >= 0.0 ? 1.0 : -1.0;
  float2 from = left_of(before) * side;
  float2 to = left_of(after) * side;
  if (corner == 1u)
    return normalize(from + to + before - after) *
           -min(1.0, pixel / 32.0 / sqrt((1.0 - cosine) / 2.0));
  if (!is_round)
    return corner == 0u ? from
           : corner == 3u
               ? to
               : (from + to) / (cosine >= style.x ? 1.0 + cosine : 2.0);
  float all = acos(max(cosine, -1.0));
  float start = min(step * 3.14159265 / style.y, all);
  float end = min((step + 1.0) * 3.14159265 / style.y, all);
  float angle = corner == 0u ? start : corner == 3u ? end : (start + end) / 2.0;
  return angle >= all ? to : from * cos(angle) + before * sin(angle);
}

FUNCTION Space space_at(uint first BUFFERS) {
  Space space;
  space.to_pixels = float4(1.0, 0.0, 0.0, 1.0);
  space.from_pixels = space.to_pixels;
  if (first != 0u) {
    space.to_pixels = FLOATS(WORD(first));
    space.from_pixels = FLOATS(WORD(first + 1u));
  }
  return space;
}

FUNCTION Corner place(uint index BUFFERS) {
  uint corner = index & 3u;
  uint unit_bits = UNIT(index >> 2);
  uint first = unit_bits >> 11;
  uint kind = (unit_bits >> 8) & 7u;
  float step = float(unit_bits & 255u);
  float end = float(corner >> 1);
  float side = (corner & 1u) == 0u ? 1.0 : -1.0;
  uint4 bits = WORD(first);

  Corner result;
  result.address = 0u;
  result.stride = 0u;
  result.from_center = float2(0.0, 0.0);
  result.reach = float2(0.0, 0.0);
  result.part = float4(0.0, 0.0, 0.0, 0.0);

  if (kind == BOX) {
    uint shape = (unit_bits & HAS_CLIP) != 0u ? first - 1u : first;
    uint source = unit_bits & SOURCE;
    int left = low_half(bits.x);
    int top = high_half(bits.x);
    result.at =
        float2(float(left) + (side > 0.0 ? 0.0 : float(bits.y & 65535u)),
               float(top) + end * float(bits.y >> 16));
    result.depth = float(shape) / 2097152.0;
    result.flags = shape << 11 | (unit_bits & 255u);
    result.color = bits.w;
    result.stride = bits.y & 65535u;
    if (source == PIXELS || source == (PIXELS | IN_TEXTURE)) {
      result.color = (bits.w & 255u) * 0x01010101u;
      result.stride = bits.w >> 8;
    }
    result.address = bits.z - uint(top) * result.stride - uint(left);
    return result;
  }
  if (kind == RING) {
    uint4 rest = WORD(first + 1u);
    rest.z += first << 11;
    float4 arc = FLOATS(bits);
    float inner = FLOATS(rest).x;
    float turns = inner > 0.0    ? step + end
                  : corner == 1u ? 0.0
                                 : step * 2.0 + float(corner - (corner >> 1));
    float angle = arc.z + turns * arc.w;
    angle -= 6.28318531 * round(angle / 6.28318531);
    // The lines are partly outside.
    float radius = (corner == 1u && inner >= 0.0 || corner == 3u && inner > 0.0
                        ? inner
                        : FLOATS(rest).w) *
                   (1.0 + arc.w * arc.w / 12.0);
    result.at = arc.xy + float2(cos(angle), sin(angle)) * radius;
    result.depth = float(rest.z >> 11) / 2097152.0;
    result.flags = rest.z;
    result.color = rest.y;
    return result;
  }
  if (kind == RUN) {
    bits.z += first << 11;
    result.depth = float(bits.z >> 11) / 2097152.0;
    result.flags = bits.z;
    result.color = bits.y;
    uint points = first * 2u + 3u;
    if (bits.x == 0u) {
      uint next = corner - (corner >> 1);
      uint which = unit_bits & 255u;
      if (bits.w == 2u) {
        result.at = POINT(points - 1u + which * 2u + corner);
        return result;
      }
      result.at = POINT(bits.w != 0u   ? points + which * 3u +
                                             (corner == 1u ? 0u : next + 1u)
                        : corner == 1u ? points - 1u
                                       : points + which * 2u + next);
      return result;
    }
    bool is_join = (unit_bits & IS_JOIN) != 0u;
    uint here = points + (unit_bits & 31u) + 1u + (is_join ? 0u : corner >> 1);
    float2 at = POINT(here);
    Space space = space_at(bits.w >> 8 ARGUMENTS);
    float radius = FLOATS(bits).x;
    float2 beside;
    if (is_join) {
      float pixel =
          length(times(space.from_pixels, float2(0.7071, 0.7071))) / radius;
      beside = join(unit(space, at - POINT(here - 1u)),
                    unit(space, POINT(here + 1u) - at), corner,
                    float((unit_bits >> 5) & 3u),
                    (bits.z & HAS_ROUND_JOIN) != 0u, POINT(points - 1u), pixel);
    } else if ((unit_bits & (end > 0.0 ? SHARES_END : SHARES_START)) != 0u) {
      float2 before = normalize(at - POINT(here - 1u));
      float2 after = normalize(POINT(here + 1u) - at);
      beside = left_of(before + after) * (side / (1.0 + dot(before, after)));
    } else {
      beside = left_of(unit(space, end > 0.0 ? at - POINT(here - 1u)
                                             : POINT(here + 1u) - at)) *
               side;
    }
    result.at = at + times(space.to_pixels, beside * radius);
    return result;
  }
  if (kind == BAR && (unit_bits & 255u) >= ROUNDED) {
    uint4 rest = WORD(first + 1u);
    rest.z += first << 11;
    float2 along = (FLOATS(bits).zw - FLOATS(bits).xy) / 2.0;
    result.part = float4(length(along), FLOATS(WORD(first + 2u)).x,
                         FLOATS(rest).x, FLOATS(rest).w);
    along = is_zero(along) ? float2(1.0, 0.0) : along / result.part.x;
    result.from_center =
        (result.part.xy + result.part.z + result.part.w + 1.0) *
        float2(end * 2.0 - 1.0, side);
    if ((unit_bits & FRAME) != 0u) {
      uint which = ((unit_bits & 3u) + (corner >> 1)) & 3u;
      float2 hole = max(
          result.part.xy + result.part.z * 0.7071 - result.part.w - 1.0, 0.0);
      result.from_center = (side > 0.0 ? abs(result.from_center) : hole) *
                           float2(which == 1u || which == 2u ? 1.0 : -1.0,
                                  which >= 2u ? 1.0 : -1.0);
    }
    result.at = (FLOATS(bits).xy + FLOATS(bits).zw) / 2.0 +
                along * result.from_center.x +
                left_of(along) * result.from_center.y;
    result.reach = float2(-1.0, 0.0);
    result.depth = float(rest.z >> 11) / 2097152.0;
    result.flags = rest.z;
    result.color = rest.y;
    return result;
  }
  if (kind == BAR && (unit_bits & 255u) == COVER) {
    uint4 rest = WORD(first + 1u);
    rest.z += first << 11;
    result.at = float2(side > 0.0 ? FLOATS(bits).x : FLOATS(bits).z,
                       end > 0.0 ? FLOATS(bits).w : FLOATS(bits).y);
    result.depth = float(rest.z >> 11) / 2097152.0;
    result.flags = rest.z;
    result.color = rest.y;
    return result;
  }
  float4 ends = FLOATS(bits);
  uint4 head = WORD(first + 1u);
  head.z += first << 11;
  float radius = FLOATS(head).x;
  result.depth = float(head.z >> 11) / 2097152.0;
  result.color = head.y;
  result.flags = head.z;
  if (kind == BAR && (head.z & SMOOTH) == SMOOTH) {
    result.address = head.x;
    result.stride = head.w;
    head.w = 0u;
  }
  Space space = space_at(head.w >> 8 ARGUMENTS);
  if (kind == BAR) {
    float2 along = (ends.zw - ends.xy) / 2.0;
    float2 across;
    if ((result.flags & IS_LINE) != 0u) {
      float2 forward = unit(space, along) * radius;
      across = times(space.to_pixels, left_of(forward));
      if ((result.flags & HAS_SQUARE_CAPS) != 0u)
        along += times(space.to_pixels, forward);
    } else {
      across = FLOATS(WORD(first + 2u)).xy;
    }
    float2 normal_along = normalize(left_of(across));
    float2 normal_across = normalize(left_of(along));
    result.reach =
        float2(abs(dot(along, normal_along)), abs(dot(across, normal_across)));
    float2 margin = float2(abs(normal_along.x) + abs(normal_along.y),
                           abs(normal_across.x) + abs(normal_across.y));
    result.from_center =
        (result.reach + margin) * float2(end * 2.0 - 1.0, side);
    float2 times_reach = result.from_center / result.reach;
    if ((head.z & SMOOTH) == SMOOTH)
      result.part = FLOATS(WORD(first + 3u));
    result.at = (ends.xy + ends.zw) / 2.0 + along * times_reach.x +
                across * times_reach.y;
    return result;
  }

  float4 controls = FLOATS(WORD(first + 2u));
  float4 rest = FLOATS(WORD(first + 3u));
  float count = float(head.w & 255u);
  Curve curve;
  curve.a = ends.xy;
  curve.b = controls.xy;
  curve.c = controls.zw;
  curve.d = ends.zw;
  curve.is_line = (result.flags & IS_LINE) != 0u;
  if (kind == WEDGE && head.x != 0u) {
    uint which = unit_bits & 255u;
    uint left = head.x & 511u;
    uint stride = 1u;
    while (left > 1u && which >= (left + 1u) / 3u) {
      which -= (left + 1u) / 3u;
      left = (left + 2u) / 3u;
      stride *= 3u;
    }
    result.at = point_at(
        curve,
        fraction(
            float((which * 3u + (corner < 2u ? 1u - corner : corner)) * stride),
            float(head.x)));
    return result;
  }
  if (kind == WEDGE) {
    result.at =
        corner == 1u
            ? rest.xy
            : point_at(curve,
                       fraction(step * 2.0 + float(corner - (corner >> 1)),
                                count * 2.0));
    return result;
  }
  if (kind == STRIP && (unit_bits & MAY_FOLD) != 0u) {
    float from = fraction(float(unit_bits & 63u), count);
    float to = fraction(float(unit_bits & 63u) + 1.0, count);
    float2 start = point_at(curve, from);
    float2 along = point_at(curve, to) - start;
    float2 before =
        times(space.to_pixels,
              left_of(unit(space, direction_at(curve, from))) * radius);
    float2 after =
        times(space.to_pixels,
              left_of(unit(space, direction_at(curve, to))) * radius);
    float turn = dot(before, left_of(after));
    bool folds = abs(dot(along, left_of(after))) < abs(turn) &&
                 abs(dot(along, left_of(before))) < abs(turn);
    bool is_beyond = (unit_bits & BEYOND_FOLD) != 0u;
    result.at = point_at(curve, end > 0.0 ? to : from) +
                (end > 0.0 ? after : before) * (is_beyond ? -side : side);
    if (folds && side < 0.0) {
      // A little further, so that nothing shows through between neighbors.
      float2 outward = is_beyond ? -before : before;
      float2 wider =
          normalize(along + (is_beyond ? before - after : after - before)) *
          (end * 2.0 - 1.0);
      result.at = start + before * (dot(along, left_of(after)) / turn) +
                  (wider - normalize(outward)) / 32.0;
    } else if (!folds && is_beyond) {
      result.at = start;
    }
    return result;
  }
  float t = kind == STRIP ? fraction(step + end, count) : 0.0;
  float2 forward = unit(space, direction_at(curve, t));
  float2 beside = left_of(forward) * side;
  if (kind == JOIN) {
    float pixel =
        length(times(space.from_pixels, float2(0.7071, 0.7071))) / radius;
    beside = join(unit(space, rest.xy), forward, corner, step,
                  (result.flags & HAS_ROUND_JOIN) != 0u, rest.zw, pixel);
  } else if (kind != STRIP) {
    float angle = (step + end) * 1.57079633 / rest.w;
    beside = (result.flags & HAS_SQUARE_CAPS) != 0u
                 ? beside - forward * end
                 : beside * cos(angle) - forward * sin(angle);
  }
  result.at = point_at(curve, t) + times(space.to_pixels, beside * radius);
  return result;
}

// How much of a pixel is beyond a line that is so far from its center.
FUNCTION float beyond(float away, float2 slant) {
  float tip = clamp((slant.x + slant.y) / 2.0 - away, 0.0, slant.y);
  return (tip * tip / (2.0 * max(slant.y, 1e-6)) +
          max((slant.x - slant.y) / 2.0 - away, 0.0)) /
         slant.x;
}

FUNCTION float within(float from_center, float reach, float2 slant) {
  float inside = reach - abs(from_center);
  float near = beyond(abs(inside), slant);
  return (inside >= 0.0 ? 1.0 - near : near) -
         beyond(reach + abs(from_center), slant);
}

FUNCTION float2 overlap(float2 from_center, float2 reach) {
  return clamp(min(from_center + 0.5, reach) - max(from_center - 0.5, -reach),
               0.0, 1.0);
}

FUNCTION float within_rounded(float2 from_center, float4 shape) {
  if (shape.z == 0.0) {
    float2 outer = overlap(from_center, shape.xy + shape.w);
    float2 inner = overlap(from_center, shape.xy - shape.w);
    return outer.x * outer.y - inner.x * inner.y;
  }
  float2 past = abs(from_center) - shape.xy;
  float outside =
      length(max(past, 0.0)) + min(max(past.x, past.y), 0.0) - shape.z;
  return clamp(shape.w > 0.0
                   ? min(outside + 0.5, shape.w) - max(outside - 0.5, -shape.w)
                   : 0.5 - outside,
               0.0, 1.0);
}

// What `gradient.rs` does.
FUNCTION float4 shade(uint first, float2 pixel BUFFERS) {
  float4 rest = FLOATS(WORD(first + 1u));
  float4 from = FLOATS(WORD(first + 2u));
  float4 to = FLOATS(WORD(first + 3u));
  uint4 how = WORD(first + 4u);
  float2 at = times(FLOATS(WORD(first)), pixel) + rest.xy - from.xy;
  float2 span = to.xy - from.xy;
  float offset = 1.0;
  if (how.x == 0u) {
    if (!is_zero(span))
      offset = dot(at, span) / dot(span, span);
  } else if (how.x == 1u) {
    float growth = to.z - from.z;
    float a = dot(span, span) - growth * growth;
    float b = dot(at, span) + from.z * growth;
    float c = dot(at, at) - from.z * from.z;
    float square = b * b - a * c;
    if (abs(a) < 1e-9 ? b == 0.0 : square < 0.0)
      return float4(0.0, 0.0, 0.0, 0.0);
    float one = abs(a) < 1e-9 ? c / (2.0 * b) : (b + sqrt(square)) / a;
    float other = abs(a) < 1e-9 ? one : (b - sqrt(square)) / a;
    offset = from.z + max(one, other) * growth >= 0.0 ? max(one, other)
                                                      : min(one, other);
    if (from.z + offset * growth < 0.0)
      return float4(0.0, 0.0, 0.0, 0.0);
  } else {
    offset =
        fract((ANGLE(at.y, at.x) - from.z) / 6.28318531) * 6.28318531 / to.z;
  }
  if (how.y != 0u && to.w > 0.0) {
    float turns = (offset - from.w) / to.w;
    float part = fract(turns);
    offset =
        from.w +
        to.w * (how.y == 2u && fract(turns / 2.0) >= 0.5 ? 1.0 - part : part);
  }
  uint low = 0u;
  uint high = how.z;
  while (low < high) {
    uint middle = (low + high) / 2u;
    if (FLOATS(WORD(first + 5u + middle * 2u)).x <= offset)
      low = middle + 1u;
    else
      high = middle;
  }
  uint before = first + 5u + (max(low, 1u) - 1u) * 2u;
  uint after = first + 5u + min(low, how.z - 1u) * 2u;
  float start = FLOATS(WORD(before)).x;
  float progress = before == after
                       ? 0.0
                       : (offset - start) / (FLOATS(WORD(after)).x - start);
  float4 color =
      mix(FLOATS(WORD(before + 1u)), FLOATS(WORD(after + 1u)), progress) /
      255.0;
  return float4(color.xyz * (how.w != 0u ? 1.0 : color.w), color.w) * rest.z;
}

FUNCTION float4 unpacked(uint color) {
  return float4(float(color & 255u), float((color >> 8) & 255u),
                float((color >> 16) & 255u), float(color >> 24)) /
         255.0;
}

FUNCTION float byte_at(uint address BUFFERS) {
  return float((TEXEL(address >> 2) >> ((address & 3u) * 8u)) & 255u) / 255.0;
}

FUNCTION float4 texel(int x, int y, uint address, uint stride,
                      uint flags BUFFERS TEXTURES) {
  if ((flags & IN_TEXTURE) != 0u)
    return READ(image, x, y);
  return unpacked(TEXEL(address + uint(y) * stride + uint(x)));
}

// What `warp.rs` does.
FUNCTION float4 image_at(float2 at, float4 part, uint address, uint stride,
                         uint flags BUFFERS TEXTURES) {
  float2 low = floor(part.xy - abs(part.zw) + 0.001);
  float2 high = ceil(part.xy + abs(part.zw) - 0.001);
  if ((flags & SHARP) == SHARP) {
    at = clamp(floor(at), low, high - 1.0);
    return texel(int(at.x), int(at.y), address, stride,
                 flags ARGUMENTS WITH_TEXTURES);
  }
  at = clamp(at, low + 0.5, high - 0.5);
  if ((flags & IN_TEXTURE) != 0u)
    return SAMPLE(image, at);
  float2 before = floor(at - 0.5);
  float2 after = min(before + 1.0, high - 1.0);
  float2 by = at - 0.5 - before;
  uint above = address + uint(before.y) * stride;
  uint below = address + uint(after.y) * stride;
  float4 upper = mix(unpacked(TEXEL(above + uint(before.x))),
                     unpacked(TEXEL(above + uint(after.x))), by.x);
  return mix(upper,
             mix(unpacked(TEXEL(below + uint(before.x))),
                 unpacked(TEXEL(below + uint(after.x))), by.x),
             by.y);
}

FUNCTION float4 tile_at(float2 at, float2 size, uint4 how,
                        uint flags BUFFERS TEXTURES) {
  float2 wrapped = at - floor((at + 0.5) / size) * size;
  at = float2((how.w & 1u) != 0u ? wrapped.x : at.x,
              (how.w & 2u) != 0u ? wrapped.y : at.y);
  if (at.x < 0.0 || at.y < 0.0 || at.x >= size.x || at.y >= size.y)
    return float4(0.0, 0.0, 0.0, 0.0);
  return texel(int(at.x), int(at.y), how.x, how.y,
               flags ARGUMENTS WITH_TEXTURES);
}

// What `sample` in `canvas.rs` does.
FUNCTION float4 pattern(uint first, float2 pixel, uint flags BUFFERS TEXTURES) {
  float4 rest = FLOATS(WORD(first + 1u));
  uint4 how = WORD(first + 2u);
  float2 size = float2(float(how.y), float(how.z));
  float2 at = times(FLOATS(WORD(first)), pixel) + rest.xy;
  if ((how.w & 4u) == 0u)
    return tile_at(floor(at), size, how, flags ARGUMENTS WITH_TEXTURES) *
           rest.z;
  float2 before = floor(at - 0.5);
  float2 by = at - 0.5 - before;
  float4 upper = mix(tile_at(before, size, how, flags ARGUMENTS WITH_TEXTURES),
                     tile_at(before + float2(1.0, 0.0), size, how,
                             flags ARGUMENTS WITH_TEXTURES),
                     by.x);
  float4 lower = mix(
      tile_at(before + float2(0.0, 1.0), size, how,
              flags ARGUMENTS WITH_TEXTURES),
      tile_at(before + 1.0, size, how, flags ARGUMENTS WITH_TEXTURES), by.x);
  return mix(upper, lower, by.y) * rest.z;
}

FUNCTION float4 source_at(float2 pixel, Corner it BUFFERS TEXTURES) {
  uint source = it.flags & SOURCE;
  uint address = it.address + uint(pixel.y) * it.stride + uint(pixel.x);
  float4 all = unpacked(it.color);
  if (source == SOLID) {
  } else if (source == MASK) {
    all *= byte_at(address ARGUMENTS);
  } else if (source == PIXELS) {
    all *= unpacked(TEXEL(address));
  } else if (source == (PIXELS | IN_TEXTURE)) {
    all *= READ(image, int(address & 65535u), int(address >> 16));
  } else if ((source & SMOOTH) == SMOOTH) {
    all *=
        image_at(it.part.xy + it.from_center / it.reach * it.part.zw, it.part,
                 it.address, it.stride, it.flags ARGUMENTS WITH_TEXTURES);
  } else if (source == BEFORE) {
    all = READ(backdrop, int(pixel.x), int(pixel.y));
  } else if ((source & 7u) == PATTERN) {
    all = pattern(it.color, pixel, it.flags ARGUMENTS WITH_TEXTURES);
  } else {
    all = shade(it.color, pixel ARGUMENTS);
    if (source != GRADIENT)
      all *= byte_at(address ARGUMENTS);
  }
  if (it.reach.x < 0.0)
    all *= within_rounded(it.from_center, it.part);
  if (it.reach.x > 0.0) {
    float2 across = DX(it.from_center);
    float2 down = DY(it.from_center);
    all *=
        within(it.from_center.x, it.reach.x, slant(float2(across.x, down.x))) *
        within(it.from_center.y, it.reach.y, slant(float2(across.y, down.y)));
  }
  return all;
}

FUNCTION float clip_at(float2 pixel, uint flags BUFFERS) {
  if ((flags & HAS_CLIP) == 0u)
    return 1.0;
  uint4 clip = WORD(flags >> 11);
  uint x = uint(pixel.x);
  uint y = uint(pixel.y);
  if (x < (clip.x & 65535u) || y < (clip.x >> 16) || x >= (clip.y & 65535u) ||
      y >= (clip.y >> 16))
    return 0.0;
  return clip.w == 0u ? 1.0 : byte_at(clip.z + y * clip.w + x ARGUMENTS);
}

// What is added, and how much is taken away from what is there.
struct Change {
  float4 added;
  float4 taken;
};

FUNCTION Change paint(float2 pixel, Corner it,
                      bool stays_opaque BUFFERS TEXTURES) {
  float4 source = source_at(pixel, it ARGUMENTS WITH_TEXTURES);
  float inside = clip_at(pixel, it.flags ARGUMENTS);
  uint how = it.flags & OPERATOR;
  float taken = how == PLUS   ? 0.0
                : how == COPY ? 1.0
                : how == KEEP ? 1.0 - source.w
                              : source.w;
  Change result;
  result.added = how == ERASE || how == KEEP ? float4(0.0, 0.0, 0.0, 0.0)
                                             : source * inside;
  result.taken =
      (how == SCREEN ? source : float4(taken, taken, taken, taken)) * inside;
  if (stays_opaque) {
    result.added.w = 0.0;
    result.taken.w = 0.0;
  }
  return result;
}

FUNCTION float hard_light(float s, float b) {
  return s <= 0.5 ? 2.0 * s * b : 1.0 - 2.0 * (1.0 - s) * (1.0 - b);
}

FUNCTION float mix_channel(uint mode, float s, float b) {
  if (mode == OVERLAY)
    return hard_light(b, s);
  if (mode == DARKEN)
    return min(s, b);
  if (mode == LIGHTEN)
    return max(s, b);
  if (mode == COLOR_DODGE)
    return b == 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(b / (1.0 - s), 1.0);
  if (mode == COLOR_BURN)
    return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min((1.0 - b) / s, 1.0);
  if (mode == HARD_LIGHT)
    return hard_light(s, b);
  if (mode == SOFT_LIGHT)
    return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b)
                    : b + (2.0 * s - 1.0) *
                              ((b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b
                                          : sqrt(b)) -
                               b);
  if (mode == DIFFERENCE)
    return abs(s - b);
  if (mode == EXCLUSION)
    return s + b - 2.0 * s * b;
  return s * b;
}

FUNCTION float luminosity(float3 it) {
  return dot(it, float3(0.3, 0.59, 0.11));
}

FUNCTION float3 with_luminosity(float3 color, float wanted) {
  color += wanted - luminosity(color);
  float low = min(min(color.x, color.y), color.z);
  float high = max(max(color.x, color.y), color.z);
  if (low < 0.0)
    color = wanted + (color - wanted) * wanted / (wanted - low);
  if (high > 1.0)
    color = wanted + (color - wanted) * (1.0 - wanted) / (high - wanted);
  return color;
}

FUNCTION float3 with_saturation_of(float3 color, float3 other) {
  float low = min(min(color.x, color.y), color.z);
  float high = max(max(color.x, color.y), color.z);
  float range =
      max(max(other.x, other.y), other.z) - min(min(other.x, other.y), other.z);
  return high > low ? (color - low) * range / (high - low)
                    : float3(0.0, 0.0, 0.0);
}

// What `blend.rs` does.
FUNCTION float4 blend(uint mode, float4 above, float4 below) {
  if (mode <= XOR) {
    float of_source =
        mode == SOURCE_IN || mode == SOURCE_ATOP ? below.w : 1.0 - below.w;
    float of_backdrop = mode == DESTINATION_OVER             ? 1.0
                        : mode == DESTINATION_ATOP           ? above.w
                        : mode == SOURCE_ATOP || mode == XOR ? 1.0 - above.w
                                                             : 0.0;
    return above * of_source + below * of_backdrop;
  }
  float3 s = min(above.xyz / max(above.w, 1.0 / 255.0), 1.0);
  float3 b = min(below.xyz / max(below.w, 1.0 / 255.0), 1.0);
  float3 mixed;
  if (mode == HUE)
    mixed = with_luminosity(with_saturation_of(s, b), luminosity(b));
  else if (mode == SATURATION)
    mixed = with_luminosity(with_saturation_of(b, s), luminosity(b));
  else if (mode == COLOR)
    mixed = with_luminosity(s, luminosity(b));
  else if (mode == LUMINOSITY)
    mixed = with_luminosity(b, luminosity(s));
  else
    mixed = float3(mix_channel(mode, s.x, b.x), mix_channel(mode, s.y, b.y),
                   mix_channel(mode, s.z, b.z));
  float alpha = above.w + below.w * (1.0 - above.w);
  return float4(min(above.xyz * (1.0 - below.w) + below.xyz * (1.0 - above.w) +
                        mixed * above.w * below.w,
                    alpha),
                alpha);
}

FUNCTION float4 paint_on(float4 below, uint mode, float2 pixel, Corner it,
                         bool stays_opaque BUFFERS TEXTURES) {
  float4 result = mix(
      below, blend(mode, source_at(pixel, it ARGUMENTS WITH_TEXTURES), below),
      clip_at(pixel, it.flags ARGUMENTS));
  if (stays_opaque)
    result.w = 1.0;
  return result;
}
