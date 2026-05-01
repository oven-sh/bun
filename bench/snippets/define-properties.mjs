import { bench, run } from "../runner.mjs";

const properties = {
  closed: {
    get() {
      return this._writableState ? this._writableState.closed : false;
    },
  },
  destroyed: {
    get() {
      return this._writableState ? this._writableState.destroyed : false;
    },
    set(value) {
      if (this._writableState) {
        this._writableState.destroyed = value;
      }
    },
  },
  writable: {
    get() {
      const w = this._writableState;
      return !!w && w.writable !== false && !w.destroyed && !w.errored && !w.ending && !w.ended;
    },
    set(val) {
      if (this._writableState) {
        this._writableState.writable = !!val;
      }
    },
  },
  writableFinished: {
    get() {
      return this._writableState ? this._writableState.finished : false;
    },
  },
  writableObjectMode: {
    get() {
      return this._writableState ? this._writableState.objectMode : false;
    },
  },
  writableBuffer: {
    get() {
      return this._writableState && this._writableState.getBuffer();
    },
  },
  writableEnded: {
    get() {
      return this._writableState ? this._writableState.ending : false;
    },
  },
  writableNeedDrain: {
    get() {
      const wState = this._writableState;
      if (!wState) return false;
      return !wState.destroyed && !wState.ending && wState.needDrain;
    },
  },
  writableHighWaterMark: {
    get() {
      return this._writableState && this._writableState.highWaterMark;
    },
  },
  writableCorked: {
    get() {
      return this._writableState ? this._writableState.corked : 0;
    },
  },
  writableLength: {
    get() {
      return this._writableState && this._writableState.length;
    },
  },
  errored: {
    enumerable: false,
    get() {
      return this._writableState ? this._writableState.errored : null;
    },
  },
  writableAborted: {
    enumerable: false,
    get: function () {
      return !!(
        this._writableState.writable !== false &&
        (this._writableState.destroyed || this._writableState.errored) &&
        !this._writableState.finished
      );
    },
  },
};

var count = 10_000;

bench("Object.defineProperty x " + count, () => {
  const prop = {
    enumerable: false,
    get: function () {
      return !!(
        this._writableState.writable !== false &&
        (this._writableState.destroyed || this._writableState.errored) &&
        !this._writableState.finished
      );
    },
  };
  for (let i = 0; i < count; i++) {
    function Hey() {
      return this;
    }
    Object.defineProperty(Hey.prototype, "writableAborted", prop);
  }
});

bench("Object.defineProperties x " + count, () => {
  for (let i = 0; i < count; i++) {
    function Hey() {
      return this;
    }
    Object.defineProperties(Hey.prototype, properties);
  }
});

bench("(all the keys) Object.defineProperties x " + count, () => {
  var first;
  {
    function Hey() {
      return this;
    }
    Object.defineProperties(Hey.prototype, properties);
    first = Object.getOwnPropertyDescriptors(Hey.prototype);
  }

  for (let i = 0; i < count; i++) {
    function Hey() {
      return this;
    }
    Object.defineProperties(Hey.prototype, first);
  }
});

await run();
