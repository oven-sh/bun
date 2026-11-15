// What stands in front of a loop: a list read through a field in a loop a field filled later.
"use strict";
class Box { fill() { this.items = JSON.parse("[1,2,3]"); } sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += this.items[i]; return s; } }
const box = new Box();
try { console.log("SAID", box.sum(Number("0"))); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", box.sum(Number("1"))); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", (box.fill(), box.sum(Number("3")))); } catch (error) { console.log("SAID", error.name); }
