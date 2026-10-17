import freeGlobal from './_freeGlobal.js';
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;
var root = freeGlobal || freeSelf || Function('return this')();
export default root;
