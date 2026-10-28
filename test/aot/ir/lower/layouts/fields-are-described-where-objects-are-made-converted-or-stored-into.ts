// RUN(MENTIONED): link
// MENTIONED: layout {{*}}name="Mentioned" {{*}}fields=[{key="count" declared={type=anything} {{*}}{key="label" declared={type=anything}

// RUN(MADE): link
// MADE: layout {{*}}name="Made" {{*}}fields=[{key="count" declared={type=number} flags=[IsRequired]}

// RUN(CONVERTED): link
// CONVERTED: layout {{*}}name="Converted" {{*}}fields=[{key="count" declared={type=number}

// RUN(ASSERTED): link
// ASSERTED: layout {{*}}name="Asserted" {{*}}fields=[{key="size" declared={type=number}

// RUN(STORED): link
// STORED: layout {{*}}name="Stored" {{*}}fields=[{key="total" declared={type=number}

// RUN(EXTENDED): link
// EXTENDED: layout {{*}}name="Extended" {{*}}fields=[{key="base" declared={type=number}

// What a slot holds is what is stored there, and an object is stored into where it is made or through a type that it was converted to. So a file says what the fields
// of a layout hold where it makes an object with the layout, converts a value to one of its types, takes a value that nothing is known of for one, or stores through
// one, and of what such a type extends. Of a layout that it only mentions it says which names the type has and which it requires.
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

export function read(mentioned: Mentioned) {
  return mentioned.count;
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
