function f111() { return 'ok 111'; }
const e = exports; const put = (o, k, v) => { o[k] = v; }; put(e, 'f111', f111);
