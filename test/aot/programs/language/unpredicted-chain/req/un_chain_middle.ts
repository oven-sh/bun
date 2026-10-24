import base from "./un_chain_base";
const Base = base as any;
function Middle(this: any, options?: any) { Base.call(this, options); this.middle = true; }
Object.setPrototypeOf(Middle.prototype, Base.prototype);
Object.setPrototypeOf(Middle, Base);
Middle.prototype.name = function name() { return "middle"; };
function helper(e: any, type: any, fn: any) { return e.on(type, fn); }
export default { Middle, helper } as unknown as { Middle: any; helper: any };
