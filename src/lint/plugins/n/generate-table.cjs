// What `generate-data.mjs` and `generate-es-syntax.cjs` share: they write a tree of names in the form of `table.rs`.

const NONE = 0xffff;

const check = (value, limit, what) => {
  if (!(value >= 0 && value < limit)) throw new Error(`${what}: ${value} does not fit`);
  return value;
};

/** Finds `list` in `pool`, both lists of strings, or appends it. Returns where it starts. */
function place(pool, list) {
  for (let start = 0; start + list.length <= pool.length; start++) {
    if (list.every((it, i) => pool[start + i] === it)) return start;
  }
  pool.push(...list);
  return pool.length - list.length;
}

class Table {
  /** For each array of members its rows: `{ name, kinds: [read, call, construct], members: an array or undefined }`. */
  arrays = [];
  texts = new Set();

  /** An array of members that is filled later, so that a member of it can have it as its members. */
  reserve() {
    return this.arrays.push(null) - 1;
  }

  fill(array, rows) {
    this.arrays[array] = rows;
    for (const row of rows) this.texts.add(row.name);
    return array;
  }

  add(rows) {
    return this.fill(this.reserve(), rows);
  }

  /** A text that is no name of a member. */
  text(text) {
    this.texts.add(text);
    return text;
  }

  /** The texts are in place from here on. A text that is part of another is not there twice. */
  layOut() {
    this.names = "";
    for (const text of [...this.texts].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))) {
      if (Buffer.byteLength(text) !== text.length) throw new Error(`${text} is not ASCII`);
      if (!this.names.includes(text)) this.names += text;
    }
    // Arrays with the same rows are one, also those that are the same only once their members are one.
    const one = this.arrays.map((_, array) => array);
    for (let found = true; found;) {
      found = false;
      const seen = new Map();
      this.arrays.forEach((rows, array) => {
        if (one[array] !== array) return;
        const key = JSON.stringify(rows.map(row => ({ ...row, members: one[row.members] })));
        if (seen.has(key)) found = true;
        one[array] = seen.get(key) ?? array;
        seen.set(key, one[array]);
      });
      one.forEach((it, array) => (one[array] = one[it]));
    }
    this.one = one;
    const kept = this.arrays.filter((_, array) => one[array] === array);
    this.first = [];
    let count = 0;
    this.arrays.forEach((rows, array) => {
      if (one[array] === array) ((this.first[array] = count), (count += rows.length));
    });
    this.kinds = [];
    this.rows = kept.flat().map(row => {
      const kinds = JSON.stringify(
        (row.kinds ?? [])
          .concat(NONE, NONE, NONE)
          .slice(0, 3)
          .map(it => it ?? NONE),
      );
      if (!this.kinds.includes(kinds)) this.kinds.push(kinds);
      return `    m(${this.textOf(row.name)}, ${this.kinds.indexOf(kinds)}, ${this.runOf(row.members)}), // ${row.name}`;
    });
  }

  /** The arguments of `Part::new` for a text. */
  textOf(text) {
    return `${check(this.names.indexOf(text), 0x10000, text)}, ${check(text.length, 0x100, text)}`;
  }

  /** The arguments of `Part::new` for an array of members. */
  runOf(array) {
    if (array === undefined || this.arrays[array].length === 0) return "0, 0";
    return `${check(this.first[this.one[array]], 0x10000, "first")}, ${check(this.arrays[array].length, 0x100, "count")}`;
  }

  /** The statics, and the type `name` that stands for them. */
  statics(name, about) {
    return `/// ${about}
pub(crate) enum ${name} {}

impl Table for ${name} {
    fn names() -> &'static str {
        NAMES
    }

    fn members() -> &'static [Member<Self>] {
        &MEMBERS
    }

    fn kinds() -> &'static [[u16; 3]] {
        &KINDS
    }
}

const fn m(name: u16, name_len: u8, kinds: u16, first: u16, count: u8) -> Member<${name}> {
    Member::new(Part::new(name, name_len), kinds, Part::new(first, count))
}

#[rustfmt::skip]
static NAMES: &str = ${JSON.stringify(this.names)};

/// What is at \`[READ]\`, \`[CALL]\` and \`[CONSTRUCT]\`.
#[rustfmt::skip]
static KINDS: [[u16; 3]; ${this.kinds.length}] = [
${this.kinds.map(it => `    ${it.replaceAll(",", ", ").replaceAll(String(NONE), "NONE")},`).join("\n")}
];

#[rustfmt::skip]
static MEMBERS: [Member<${name}>; ${this.rows.length}] = [
${this.rows.join("\n")}
];`;
  }
}

module.exports = { NONE, Table, check, place };
