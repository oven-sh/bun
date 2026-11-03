// Object literals that begin with a spread and go on with members of their own, some of which the spread has given already: the keys come out in the order of their creation,
// the first time a literal is evaluated and every time after it, whatever the spread brought: nothing, names the literal has too, names it lacks, many names.
const sources: Record<string, unknown>[] = [
    {},
    { isEnabled: () => true, isReadOnly: () => false, userFacingName: () => '', maxResultSize: 1000, aliases: [] },
    { zeta: 1, name: 'from the spread', alpha: 2 },
    Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['extra' + i, i])),
    { 2: 'two', 1: 'one', version: -1, [Symbol.for('mark')]: true },
];
function makeAll(source: Record<string, unknown>): Record<string, unknown>[] {
    return [
        { ...source, name: 'tool0', description0: 'd0', userFacingName: () => 'Tool 0', call0: (x: number) => x + 0, render0: () => 'r0', isReadOnly: () => true, schema: { id: 0 }, version: 0 },
        { ...source, name: 'tool1', description1: 'd1', userFacingName: () => 'Tool 1', call1: (x: number) => x + 1, render1: () => 'r1', isReadOnly: () => false, schema: { id: 1 }, version: 1 },
        { ...source, name: 'tool2', description2: 'd2', userFacingName: () => 'Tool 2', call2: (x: number) => x + 2, render2: () => 'r2', isReadOnly: () => true, schema: { id: 2 }, version: 2 },
        { ...source, name: 'tool3', description3: 'd3', userFacingName: () => 'Tool 3', call3: (x: number) => x + 3, render0: () => 'r3', isReadOnly: () => false, schema: { id: 3 }, version: 3 },
        { ...source, name: 'tool4', description4: 'd4', userFacingName: () => 'Tool 4', call4: (x: number) => x + 4, render1: () => 'r4', isReadOnly: () => true, schema: { id: 4 }, version: 4 },
        { ...source, name: 'tool5', description5: 'd5', userFacingName: () => 'Tool 5', call0: (x: number) => x + 5, render2: () => 'r5', isReadOnly: () => false, schema: { id: 5 }, version: 5 },
        { ...source, name: 'tool6', description6: 'd6', userFacingName: () => 'Tool 6', call1: (x: number) => x + 6, render0: () => 'r6', isReadOnly: () => true, schema: { id: 6 }, version: 6 },
        { ...source, name: 'tool7', description0: 'd7', userFacingName: () => 'Tool 7', call2: (x: number) => x + 7, render1: () => 'r7', isReadOnly: () => false, schema: { id: 7 }, version: 7 },
        { ...source, name: 'tool8', description1: 'd8', userFacingName: () => 'Tool 8', call3: (x: number) => x + 8, render2: () => 'r8', isReadOnly: () => true, schema: { id: 8 }, version: 8 },
        { ...source, name: 'tool9', description2: 'd9', userFacingName: () => 'Tool 9', call4: (x: number) => x + 9, render0: () => 'r9', isReadOnly: () => false, schema: { id: 9 }, version: 9 },
        { ...source, name: 'tool10', description3: 'd10', userFacingName: () => 'Tool 10', call0: (x: number) => x + 10, render1: () => 'r10', isReadOnly: () => true, schema: { id: 10 }, version: 10 },
        { ...source, name: 'tool11', description4: 'd11', userFacingName: () => 'Tool 11', call1: (x: number) => x + 11, render2: () => 'r11', isReadOnly: () => false, schema: { id: 11 }, version: 11 },
        { ...source, name: 'tool12', description5: 'd12', userFacingName: () => 'Tool 12', call2: (x: number) => x + 12, render0: () => 'r12', isReadOnly: () => true, schema: { id: 12 }, version: 12 },
        { ...source, name: 'tool13', description6: 'd13', userFacingName: () => 'Tool 13', call3: (x: number) => x + 13, render1: () => 'r13', isReadOnly: () => false, schema: { id: 13 }, version: 13 },
        { ...source, name: 'tool14', description0: 'd14', userFacingName: () => 'Tool 14', call4: (x: number) => x + 14, render2: () => 'r14', isReadOnly: () => true, schema: { id: 14 }, version: 14 },
        { ...source, name: 'tool15', description1: 'd15', userFacingName: () => 'Tool 15', call0: (x: number) => x + 15, render0: () => 'r15', isReadOnly: () => false, schema: { id: 15 }, version: 15 },
        { ...source, name: 'tool16', description2: 'd16', userFacingName: () => 'Tool 16', call1: (x: number) => x + 16, render1: () => 'r16', isReadOnly: () => true, schema: { id: 16 }, version: 16 },
        { ...source, name: 'tool17', description3: 'd17', userFacingName: () => 'Tool 17', call2: (x: number) => x + 17, render2: () => 'r17', isReadOnly: () => false, schema: { id: 17 }, version: 17 },
        { ...source, name: 'tool18', description4: 'd18', userFacingName: () => 'Tool 18', call3: (x: number) => x + 18, render0: () => 'r18', isReadOnly: () => true, schema: { id: 18 }, version: 18 },
        { ...source, name: 'tool19', description5: 'd19', userFacingName: () => 'Tool 19', call4: (x: number) => x + 19, render1: () => 'r19', isReadOnly: () => false, schema: { id: 19 }, version: 19 },
        { ...source, name: 'tool20', description6: 'd20', userFacingName: () => 'Tool 20', call0: (x: number) => x + 20, render2: () => 'r20', isReadOnly: () => true, schema: { id: 20 }, version: 20 },
        { ...source, name: 'tool21', description0: 'd21', userFacingName: () => 'Tool 21', call1: (x: number) => x + 21, render0: () => 'r21', isReadOnly: () => false, schema: { id: 21 }, version: 21 },
        { ...source, name: 'tool22', description1: 'd22', userFacingName: () => 'Tool 22', call2: (x: number) => x + 22, render1: () => 'r22', isReadOnly: () => true, schema: { id: 22 }, version: 22 },
        { ...source, name: 'tool23', description2: 'd23', userFacingName: () => 'Tool 23', call3: (x: number) => x + 23, render2: () => 'r23', isReadOnly: () => false, schema: { id: 23 }, version: 23 },
    ];
}
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
    for (const [index, source] of sources.entries()) {
        const made = makeAll(source);
        const texts = made.map((tool) => Reflect.ownKeys(tool).map(String).join());
        lines.push(round + ' ' + index + ' ' + texts[0] + ' | ' + texts[5] + ' | ' + texts[23]);
        lines.push('  ' + new Set(texts).size + ' ' + JSON.stringify(made[7]).length + ' ' + Object.entries(made[11]).length + ' ' + Object.keys({ ...made[13], last: 1 }).join().length);
        made[3].added = 1;
        delete made[3].name;
        made[3].name = 'again';
        lines.push('  ' + Object.keys(made[3]).slice(-4).join());
    }
}
console.log(lines.join('\n'));
