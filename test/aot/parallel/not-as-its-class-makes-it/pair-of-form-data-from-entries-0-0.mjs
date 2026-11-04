// Own value 0 of what is made (pair of form data) comes out by from entries.
function formData() { const data = new FormData(); data.append("a", "1"); return data; }
function use(e) { return typeof e; }
const m = formData().entries().next().value;
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
