// In front of its declaration the name throws, also where the build knows the length of its text.
function early() { return late.length; }
try { console.log(early()); } catch (error: any) { console.log(error.constructor.name, error.message); } // @ts-expect-error
try { console.log(late.length); } catch (error: any) { console.log(error.constructor.name, error.message); }
const late = "late";
console.log(early(), late.length);
