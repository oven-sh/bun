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
const plane = { weight: 4, hidden: false, nicknames: [] as string[], name: "plane" };
const tools: Tool[] = [hammer, saw, drill, rasp, plane];

function describe(tool: Tool): string {
    const nicknames = tool.nicknames;
    return tool.name + ":" + tool.weight + ":" + (nicknames === undefined ? "none" : nicknames.join("+")) + ":" + String(tool.hidden);
}

function describeAll(): string {
    let text = "";
    for (let index = 0; index < tools.length; index++)
        text += describe(tools[index]) + " ";
    return text;
}

console.log(describeAll());
console.log(describeAll() === describeAll());
