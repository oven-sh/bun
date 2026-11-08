// What a compiler of TypeScript writes for an enum: each name holds a number, each number holds its name. A switch compares with what the names hold.
var State;
(function (State) {
    State[State["Data"] = 0] = "Data";
    State[State["TagOpen"] = 1] = "TagOpen";
    State[State["TagName"] = 2] = "TagName";
    State[State["Attribute"] = 3] = "Attribute";
    State[State["Value"] = 4] = "Value";
    State[State["Comment"] = 5] = "Comment";
})(State || (State = {}));
class Tokenizer {
    constructor() { this.state = State.Data; this.said = []; }
    step(code) {
        switch (this.state) {
            case State.Data: this.state = code === 60 ? State.TagOpen : State.Data; break;
            case State.TagOpen: this.state = code === 33 ? State.Comment : State.TagName; break;
            case State.TagName: this.state = code === 32 ? State.Attribute : code === 62 ? State.Data : State.TagName; break;
            case State.Attribute: this.state = code === 61 ? State.Value : code === 62 ? State.Data : State.Attribute; break;
            case State.Value: this.state = code === 32 ? State.Attribute : code === 62 ? State.Data : State.Value; break;
            case State.Comment: this.state = code === 62 ? State.Data : State.Comment; break;
            default: throw new Error("no such state");
        }
        this.said.push(State[this.state]);
    }
}
const tokenizer = new Tokenizer();
for (const sign of "a<b c=d e>f<!g>h") tokenizer.step(sign.charCodeAt(0));
console.log(tokenizer.said.join(" "), Object.keys(State).join());
