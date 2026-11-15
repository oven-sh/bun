// Under: --aot-check=Validate: a static field that the class lists hides a static getter above: readers find the field first, and the judge of the names that are laid stopped this right build
class Base { static get make() { return 1; } }
class Middle extends Base { static make = 2; }
class Lowest extends Middle {}
function lay() { Lowest.make = () => 3; }
function read(holder) { return holder.make; }
console.log(read(Base), read(Middle), read(Lowest));
lay();
console.log(read(Base), read(Middle), typeof read(Lowest), read(Lowest)());
