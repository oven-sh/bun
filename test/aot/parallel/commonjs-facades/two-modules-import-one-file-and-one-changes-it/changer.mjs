import Shared from './shared.cjs';
export function change() { Shared.prototype.read = function () { return this.v * 10; }; }
