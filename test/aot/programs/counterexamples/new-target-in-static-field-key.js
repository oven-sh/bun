// `new.target` in the computed key of a static field is that of the function around the class.
new function F() { class C { static [console.log(new.target === F, (() => new.target)() === F)]; } };
