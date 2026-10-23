// Code shared by `generate-data.mjs` and `generate-es-syntax.cjs`. Both write a tree of names in the format `table.rs`
// reads.

const NONE = 0xffff;

const check = (value, limit, what) => {
  if (!(value >= 0 && value < limit)) throw new Error(`${what}: ${value} does not fit`);
  return value;
};

/** Finds `list` in `pool`, both lists of strings, or appends it. Returns its start index. */
function findOrAppend(pool, list) {
  for (let start = 0; start + list.length <= pool.length; start++) {
    if (list.every((it, i) => pool[start + i] === it)) return start;
  }
  pool.push(...list);
  return pool.length - list.length;
}

/** Formats an array's rows, with as many per line as fit. */
function pack(rows) {
  const lines = [];
  let line = "   ";
  for (const row of rows) {
    if (line.length + row.length + 2 > 120) (lines.push(line), (line = "   "));
    line += ` ${row},`;
  }
  if (line !== "   ") lines.push(line);
  return lines.join("\n");
}

class Table {
  /** The rows of each member array: `{ name, kinds: [read, call, construct], members: an array or undefined }`. */
  arrays = [];
  texts = new Set();

  /** Reserves a member array to be filled later, so that one of its members can refer back to it. */
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

  /** Adds a text that isn't a member's name. */
  text(text) {
    this.texts.add(text);
    return text;
  }

  /** Fixes the layout, so no texts can be added afterwards. A text that's a substring of another isn't stored twice. */
  layOut() {
    this.names = "";
    for (const text of [...this.texts].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))) {
      if (Buffer.byteLength(text) !== text.length) throw new Error(`${text} is not ASCII`);
      if (!this.names.includes(text)) this.names += text;
    }
    // Merge arrays with identical rows, including arrays that only become identical once their members are merged.
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
    const unique = this.arrays.filter((_, array) => one[array] === array);
    this.first = [];
    let count = 0;
    this.arrays.forEach((rows, array) => {
      if (one[array] === array) ((this.first[array] = count), (count += rows.length));
    });
    this.kinds = [];
    this.rows = unique.flat().map(row => {
      const kinds = JSON.stringify(
        (row.kinds ?? [])
          .concat(NONE, NONE, NONE)
          .slice(0, 3)
          .map(it => it ?? NONE),
      );
      if (!this.kinds.includes(kinds)) this.kinds.push(kinds);
      return `m(${this.textOf(row.name)}, ${this.kinds.indexOf(kinds)}, ${this.runOf(row.members)})`;
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

  /** The statics, and the type `name` that implements `Table` for them. */
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

/// The values for \`[READ]\`, \`[CALL]\` and \`[CONSTRUCT]\`.
#[rustfmt::skip]
static KINDS: [[u16; 3]; ${this.kinds.length}] = [
${pack(this.kinds.map(it => it.replaceAll(",", ", ").replaceAll(String(NONE), "NONE")))}
];

#[rustfmt::skip]
static MEMBERS: [Member<${name}>; ${this.rows.length}] = [
${pack(this.rows)}
];`;
  }
}

module.exports = { NONE, Table, check, pack, findOrAppend };
