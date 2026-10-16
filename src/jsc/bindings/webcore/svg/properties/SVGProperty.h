#pragma once

namespace WebCore {

// An SVG value object that belongs to an element has no state of its own. It parses the element's content attribute at
// each read and writes the attribute at each change. Nothing is animated, so `animVal` is a read-only view of the same attribute.
enum class SVGPropertyAccess : bool { ReadWrite, ReadOnly };

}
