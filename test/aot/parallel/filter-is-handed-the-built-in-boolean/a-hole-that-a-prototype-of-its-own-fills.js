const holed = [1, , 2];
const own = Object.create(Array.prototype); own[1] = 7; Object.setPrototypeOf(holed, own);
console.log(JSON.stringify(holed.filter(Boolean)));
