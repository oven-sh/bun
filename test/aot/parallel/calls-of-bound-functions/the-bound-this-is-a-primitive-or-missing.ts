function sloppy(this: any) { return typeof this; }
function strict(this: any) { "use strict"; return typeof this + String(this); }
const forms = [sloppy.bind(5), sloppy.bind(undefined), sloppy.bind(null), sloppy.bind("text"), strict.bind(5), strict.bind(undefined), (strict as any).bind(), strict.bind(null)];
let text = "";
for (let round = 0; round < 3; round++) for (let k = 0; k < forms.length; k++) text += forms[k]!() + ",";
const five = sloppy.bind(5), nothing = (strict as any).bind();
for (let round = 0; round < 3; round++) text += five() + nothing();
console.log(text);
