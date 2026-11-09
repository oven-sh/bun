// RUN(MENTIONED): link
// MENTIONED: layout {{*}}fields=[{key="count" declared={type=anything} flags=[IsRequired]}, {key="label" declared={type=anything}

// RUN(MADE): link
// MADE: layout {{*}}fields=[{key="count" declared={type=number} flags=[IsRequired]}, {key="made" declared={type=boolean}

// RUN(CONVERTED): link
// CONVERTED: layout {{*}}fields=[{key="count" declared={type=number} flags=[IsRequired]}]

// RUN(ASSERTED): link
// ASSERTED: layout {{*}}fields=[{key="size" declared={type=number}

// RUN(STORED): link
// STORED: layout {{*}}fields=[{key="total" declared={type=number}

// RUN(EXTENDED): link
// EXTENDED: layout {{*}}fields=[{key="base" declared={type=number} flags=[IsRequired]}]

// Each type has names of its own, so the names tell the layouts apart.
// A file says what the fields of a layout hold where it makes an object with the layout, declares a position of one of its types (a parameter, a result) or casts to
// one, and of what such a type extends. Of a layout that it only mentions, here as what a list holds, it says which names the type has and which it requires.
interface Mentioned {
  count: number;
  label?: string;
}

interface Made {
  count: number;
  made: boolean;
}

interface Converted {
  count: number;
}

interface Asserted {
  size: number;
}

interface Stored {
  total: number;
}

interface Extended {
  base: number;
}

interface Extending extends Extended {
  more: number;
}

export function read(mentioned: Mentioned[]) {
  return mentioned[0].count;
}

export function make(): Made {
  return { count: 1, made: true };
}

export function convert(made: Made): Converted {
  return made;
}

export function assert(value: unknown) {
  return (value as Asserted).size;
}

export function store(stored: Stored) {
  stored.total = 1;
}

export function extend(value: unknown) {
  return (value as Extending).base;
}
