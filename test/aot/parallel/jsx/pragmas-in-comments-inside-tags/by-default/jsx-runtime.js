const make = tag => ({ via: 'the runtime by-default', tag: String(tag) });
module.exports = { jsx: make, jsxs: make, jsxDEV: make, Fragment: 'the fragment by-default' };
