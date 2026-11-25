interface Tool {
    name: string;
    weight: number;
    nicknames?: string[];
    hidden?: boolean;
}

const hammer = { name: "hammer", weight: 3, nicknames: ["mallet"] };
const saw = { weight: 2, name: "saw" };
const drill = { nicknames: ["borer", "auger"], hidden: false, name: "drill", weight: 5 };
const rasp = { name: "rasp", hidden: true, weight: 1 };
const tools: Tool[] = [hammer, saw, drill, rasp];

function nicknamesOf(tool: Tool): string {
    const nicknames = tool.nicknames;
    return tool.name + ":" + (nicknames === undefined ? "none" : nicknames.join("+"));
}

function all(): string {
    let text = "";
    for (let index = 0; index < tools.length; index++)
        text += nicknamesOf(tools[index]) + " ";
    return text;
}

console.log(all());
Object.assign(rasp, JSON.parse("{\"nicknames\":[\"grater\"]}"));
console.log(all());
Object.assign(saw, JSON.parse("{\"nicknames\":[\"ripper\",\"cutter\"]}"));
console.log(all());
