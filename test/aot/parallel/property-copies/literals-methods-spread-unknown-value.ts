// Many literals of one form, each with methods and an accessor of its own, behind a spread of a value that nothing is known of: every member is the literal's own, in the order of its creation.
const hide = (0, eval)('(value) => value');
const sources: any[] = [hide({ isEnabled: () => true, isReadOnly: () => 'from the spread', render: 7, extraOne: 1, extraTwo: 2 }), hide({}), hide(null), hide({ version: 'early', name: 'early', size: 'early' })];
function makeAll(source: any): any[] {
    return [
        { ...source, name: 'tool0', async call(x: number) { return x + 0; }, mapResult0(x: number) { return x * 0; }, render() { return 'r0'; }, isReadOnly() { return true; }, get size() { return 0; }, version: 0 },
        { ...source, name: 'tool1', async call(x: number) { return x + 1; }, mapResult1(x: number) { return x * 1; }, render() { return 'r1'; }, isReadOnly() { return false; }, get size() { return 1; }, version: 1 },
        { ...source, name: 'tool2', async call(x: number) { return x + 2; }, mapResult2(x: number) { return x * 2; }, render() { return 'r2'; }, isReadOnly() { return true; }, get size() { return 2; }, version: 2 },
        { ...source, name: 'tool3', async call(x: number) { return x + 3; }, mapResult0(x: number) { return x * 3; }, render() { return 'r3'; }, isReadOnly() { return false; }, get size() { return 3; }, version: 3 },
        { ...source, name: 'tool4', async call(x: number) { return x + 4; }, mapResult1(x: number) { return x * 4; }, render() { return 'r4'; }, isReadOnly() { return true; }, get size() { return 4; }, version: 4 },
        { ...source, name: 'tool5', async call(x: number) { return x + 5; }, mapResult2(x: number) { return x * 5; }, render() { return 'r5'; }, isReadOnly() { return false; }, get size() { return 5; }, version: 5 },
        { ...source, name: 'tool6', async call(x: number) { return x + 6; }, mapResult0(x: number) { return x * 6; }, render() { return 'r6'; }, isReadOnly() { return true; }, get size() { return 6; }, version: 6 },
        { ...source, name: 'tool7', async call(x: number) { return x + 7; }, mapResult1(x: number) { return x * 7; }, render() { return 'r7'; }, isReadOnly() { return false; }, get size() { return 7; }, version: 7 },
        { ...source, name: 'tool8', async call(x: number) { return x + 8; }, mapResult2(x: number) { return x * 8; }, render() { return 'r8'; }, isReadOnly() { return true; }, get size() { return 8; }, version: 8 },
        { ...source, name: 'tool9', async call(x: number) { return x + 9; }, mapResult0(x: number) { return x * 9; }, render() { return 'r9'; }, isReadOnly() { return false; }, get size() { return 9; }, version: 9 },
        { ...source, name: 'tool10', async call(x: number) { return x + 10; }, mapResult1(x: number) { return x * 10; }, render() { return 'r10'; }, isReadOnly() { return true; }, get size() { return 10; }, version: 10 },
        { ...source, name: 'tool11', async call(x: number) { return x + 11; }, mapResult2(x: number) { return x * 11; }, render() { return 'r11'; }, isReadOnly() { return false; }, get size() { return 11; }, version: 11 },
        { ...source, name: 'tool12', async call(x: number) { return x + 12; }, mapResult0(x: number) { return x * 12; }, render() { return 'r12'; }, isReadOnly() { return true; }, get size() { return 12; }, version: 12 },
        { ...source, name: 'tool13', async call(x: number) { return x + 13; }, mapResult1(x: number) { return x * 13; }, render() { return 'r13'; }, isReadOnly() { return false; }, get size() { return 13; }, version: 13 },
        { ...source, name: 'tool14', async call(x: number) { return x + 14; }, mapResult2(x: number) { return x * 14; }, render() { return 'r14'; }, isReadOnly() { return true; }, get size() { return 14; }, version: 14 },
        { ...source, name: 'tool15', async call(x: number) { return x + 15; }, mapResult0(x: number) { return x * 15; }, render() { return 'r15'; }, isReadOnly() { return false; }, get size() { return 15; }, version: 15 },
        { ...source, name: 'tool16', async call(x: number) { return x + 16; }, mapResult1(x: number) { return x * 16; }, render() { return 'r16'; }, isReadOnly() { return true; }, get size() { return 16; }, version: 16 },
        { ...source, name: 'tool17', async call(x: number) { return x + 17; }, mapResult2(x: number) { return x * 17; }, render() { return 'r17'; }, isReadOnly() { return false; }, get size() { return 17; }, version: 17 },
        { ...source, name: 'tool18', async call(x: number) { return x + 18; }, mapResult0(x: number) { return x * 18; }, render() { return 'r18'; }, isReadOnly() { return true; }, get size() { return 18; }, version: 18 },
        { ...source, name: 'tool19', async call(x: number) { return x + 19; }, mapResult1(x: number) { return x * 19; }, render() { return 'r19'; }, isReadOnly() { return false; }, get size() { return 19; }, version: 19 },
        { ...source, name: 'tool20', async call(x: number) { return x + 20; }, mapResult2(x: number) { return x * 20; }, render() { return 'r20'; }, isReadOnly() { return true; }, get size() { return 20; }, version: 20 },
        { ...source, name: 'tool21', async call(x: number) { return x + 21; }, mapResult0(x: number) { return x * 21; }, render() { return 'r21'; }, isReadOnly() { return false; }, get size() { return 21; }, version: 21 },
        { ...source, name: 'tool22', async call(x: number) { return x + 22; }, mapResult1(x: number) { return x * 22; }, render() { return 'r22'; }, isReadOnly() { return true; }, get size() { return 22; }, version: 22 },
        { ...source, name: 'tool23', async call(x: number) { return x + 23; }, mapResult2(x: number) { return x * 23; }, render() { return 'r23'; }, isReadOnly() { return false; }, get size() { return 23; }, version: 23 },
    ];
}
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
    for (const [index, source] of sources.entries()) {
        const made = makeAll(source);
        let sum = 0;
        for (const [i, tool] of made.entries()) sum += tool['mapResult' + (i % 3)](2) + tool.render().length + (tool.isReadOnly() ? 1 : 0) + tool.size + tool.version + (await tool.call(1));
        lines.push(round + ' ' + index + ' ' + sum + ' ' + new Set(made.map((tool) => Object.keys(tool).join())).size + ' ' + Object.keys(made[5]).join() + ' ' + typeof Object.getOwnPropertyDescriptor(made[7], 'size')!.get);
    }
}
console.log(lines.join('\n'));
