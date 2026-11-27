class Base {}
class Heir extends Base {
    own = 1;
}
Object.defineProperty(Base.prototype, "then", {
    value(resolve) {
        resolve(9);
    },
});
async function ask() {
    return await new Heir();
}
ask().then((answer) => console.log(typeof answer, answer === 9));
