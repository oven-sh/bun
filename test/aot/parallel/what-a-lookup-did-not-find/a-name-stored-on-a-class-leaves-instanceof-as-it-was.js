class Plain {}
class Heir extends Plain {}
Plain.label = "plain";
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Plain()), ask(new Heir()), Heir.label);
