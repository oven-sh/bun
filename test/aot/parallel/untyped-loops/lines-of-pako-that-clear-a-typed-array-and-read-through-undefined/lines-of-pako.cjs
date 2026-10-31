var MAX_BITS = 15;
var extra_lbits = new Uint8Array([]);
var put_short = (s, w) => {};
var send_code = (s, c, tree) => {};
var gen_bitlen = (s, desc) => {
  let bits;
  for (bits = 0; bits <= MAX_BITS; bits++) s.bl_count[bits] = 0;
  tree[s.heap[s.heap_max] * 2 + 1] = 0;
  for (h = s.heap_max + 1; h < HEAP_SIZE$1; h++) {}
  while (j <= s.heap_len) {}
};
var build_tree = (s, desc) => {
  for (n = 0; n < elems; n++)
    if (tree[n * 2] !== 0) {
    }
  while (s.heap_len >= 2);
  gen_bitlen(s, desc);
};
var build_bl_tree = s => {};
var send_all_trees = (s, lcodes, dcodes, blcodes) => {};
var _tr_stored_block = (s, buf, stored_len, last) => {};
var _tr_align = s => {};
var _tr_flush_block = (s, buf, stored_len, last) => {
  if (s.level > 0) {
    build_tree(s, s.d_desc);
  }
  for (const end8 = end - 7; i < end8; i += 8) {}
};
var messages_default = {};
var flush_pending = strm => {};
var flush_block_only = (s, last) => {
  _tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
};
var putShortMSB = (s, b) => {};
var deflate_stored = (s, flush) => {
  if (used) {
  }
  if (flush === 4) {
  }
};
var deflate_rle = (s, flush) => {};
var deflate_huff = (s, flush) => {
  for (;;) {
    if (s.lookahead === 0) {
      flush_block_only(s, false);
    }
  }
};
var configuration_table = [];
var lm_init = s => {};
var DeflateState = class {
  constructor() {
    this.bl_count = /* @__PURE__ */ new Uint16Array(16);
    this.heap = /* @__PURE__ */ new Uint16Array(573);
    this.heap_max = 0;
  }
};
var deflateStateCheck = strm => {};
var deflateReset = strm => {};
var deflateInit2 = (strm, level, method, windowBits, memLevel, strategy, legacyHash) => {
  if (windowBits < 0) {
  }
  const s = new DeflateState();
  strm.state = s;
};
var deflateInit = (strm, level) => {};
var deflate$1 = (strm, flush) => {
  const s = strm.state;
  if (strm.avail_in !== 0 || s.lookahead !== 0 || (flush !== 0 && s.status !== FINISH_STATE)) {
    let bstate =
      s.level === 0
        ? deflate_stored(s, flush)
        : s.strategy === 2
          ? deflate_huff(s, flush)
          : s.strategy === 3
            ? deflate_rle(s, flush)
            : configuration_table[s.level].func(s, flush);
    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
    }
  }
  if (s.wrap === 2) {
  }
  while (s.lookahead >= MIN_MATCH) {}
  for (len = 1; len <= MAXBITS; len++) {}
};
var InflateState = class {
  constructor() {}
};
var inflateInit2 = (strm, windowBits) => {
  const state = new InflateState();
  strm.state = state;
  const order = new Uint8Array([]);
};
var ZStream = class {
  constructor() {}
};
var defaultOptions$1 = {};
var Deflate = class {
  constructor(options = {}) {
    this.strm = new ZStream();
    let status = deflateInit2(this.strm, opt.level, 8, opt.windowBits, opt.memLevel, opt.strategy, opt.legacyHash);
    if (dictionary.length) {
    }
  }
  push(data, flush_mode = false) {
    const strm = this.strm;
    for (;;) {
      if (strm.avail_out === 0) {
      }
      status = deflate$1(strm, _flush_mode);
      if (status === 1) {
      }
    }
  }
  onEnd(status) {}
};
function deflate(input, options = {}) {
  const deflator = new Deflate(options);
  deflator.push(input, true);
}
var Inflate = class {
  constructor(options = {}) {
    this.strm = new ZStream();
    let status = inflateInit2(this.strm, opt.windowBits);
    if (opt.raw && dictionary.length) {
    }
  }
  onEnd(status) {}
};
function inflate(input, options = {}) {
  const inflator = new Inflate(options);
}
exports.deflate = deflate;
exports.inflate = inflate;
