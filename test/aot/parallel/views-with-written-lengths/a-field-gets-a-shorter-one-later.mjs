class Holder { held = new Int32Array(8); at4() { return this.held[4]; } }
const holder = new Holder(); holder.held[4] = 7; console.log(holder.at4()); holder.held = new Int32Array(3); console.log(holder.at4());
