const v = () => { console.log("field runs"); return 1; };
class A { static x = v(); }
export const read = () => A;
