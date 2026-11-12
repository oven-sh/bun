interface Named {
    name: string;
    label?: string;
}

class Plain {
    name = "plain";
}
class WithField {
    name = "with field";
    label = "own";
}
class WithGetter {
    name = "with getter";
    get label(): string { return "computed"; }
}
class WithMethodAbove {
    name = "with value above";
}
(WithMethodAbove.prototype as unknown as Named).label = "above";
class Below extends WithField {
    more = 1;
}
const record = { name: "record" };
const recordWithLabel = { label: "written", name: "record with label" };
const all: Named[] = [new Plain(), new WithField(), new WithGetter(), new WithMethodAbove(), new Below(), record, recordWithLabel];

function labelOf(named: Named): string {
    return named.name + "=" + String(named.label);
}

let text = "";
for (let turn = 0; turn < 3; turn++) {
    for (let index = 0; index < all.length; index++)
        text += labelOf(all[index]) + " | ";
}
console.log(text);
