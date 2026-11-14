// RUN(ONE): link
// ONE: layout {{*}}fields=[{key="held" declared={type={{*}}number|string

// RUN(AMONG): link
// AMONG: layout {{*}}fields=[{key="kept" declared={type={{*}}number|string

// Types with the same names have one layout, so the conversion has no pair of layouts to record. From there on the object is stored into through the wider type.
interface Narrow {
  held: number;
}

interface Wide {
  held: number | string;
}

interface NarrowAmong {
  kept: number;
}

interface WideAmong {
  kept: number | string;
}

interface Other {
  other: boolean;
}

export function widen(narrow: Narrow): Wide {
  return narrow;
}

export function widenAmong(value: NarrowAmong | Other): WideAmong | Other {
  return value;
}
