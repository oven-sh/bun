// Each CommonJS file hands out a function declaration in another way. The importer reads them by named imports, by the default import and through a namespace.
import { viaExports, viaModuleExports, viaThis, viaComputed } from "./members.cjs";
import literal from "./literal.cjs";
import { shorthand } from "./literal.cjs";
import * as assigned from "./assigned.cjs";
import { viaDefine, viaGetter } from "./defined.cjs";
import whole from "./whole.cjs";
import Klass from "./class.cjs";

console.log(viaExports(), viaModuleExports(), viaThis(), viaComputed());
console.log(literal.shorthand(), literal.renamed(), literal.method(), literal.getter(), shorthand === literal.shorthand);
console.log(assigned.viaAssign(), assigned.default.viaAssign());
console.log(viaDefine(), viaGetter());
console.log(whole(), whole.property());
console.log(new Klass().method(), Klass.helper());
