// tsconfig.json says `"jsxFactory": "ns.x.h"` and `"jsxFragmentFactory": "ns.x.Fragment"`.
import ns = require("./lib");
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
console.log(<div a="1">x</div>);
console.log(<><b /></>);
