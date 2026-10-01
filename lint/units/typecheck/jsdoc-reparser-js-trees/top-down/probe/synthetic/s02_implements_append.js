/** @implements {A} */
class C implements B {}
/**
 * @implements {A}
 * @implements {B}
 */
const D = class {};
/** @augments {Base<string>} */
class E extends Base {}
/** @extends {ns.Base<number, string>} */
class F extends ns.Base {}
/** @augments {Other<string>} */
class G extends Base {}
