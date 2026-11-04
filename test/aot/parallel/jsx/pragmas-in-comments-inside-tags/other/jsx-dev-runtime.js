const make = tag => ({ via: 'the runtime other', tag: String(tag) });
module.exports = { jsx: make, jsxs: make, jsxDEV: make, Fragment: 'the fragment other' };
