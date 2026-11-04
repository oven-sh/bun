function helper() { return "helped"; }
with ({}) { console.log(helper()); }
with ({ helper() { return "of the object"; } }) { console.log(helper()); }
