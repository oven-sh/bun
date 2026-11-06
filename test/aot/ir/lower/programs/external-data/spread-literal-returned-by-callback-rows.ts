// RUN: lower
// OPTIONS: builtin-modules

// `rows.map(row => ({ ...mentionOf(row), body: row.body }))` over rows of sql<Row[]>, where Hit[] is expected: the literal is copied as a Hit. It was born with an anonymous layout of its own and converted at the first place that wants a Hit.
import { SQL } from "bun";

type State = "open" | "closed";
interface Row {
  id: number;
  title: string;
  state: State;
  login: string;
  body: string;
}
interface Author {
  login: string;
}
interface Mention {
  id: number;
  title: string;
  state: State;
  author: Author;
}
interface Hit extends Mention {
  body: string;
  words: number;
}
interface Marked extends Row {
  mark: number;
}
interface Numbered extends Row {
  position: number;
}

const db = new SQL("sqlite://:memory:");
await db`CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT, state TEXT, login, body TEXT)`;
await db`INSERT INTO issues VALUES (1, 'first', 'open', 'ann', 'one two three'), (2, 'second', 'closed', 'bob', ''), (3, 'naïve — 日本語', 'open', 'ann', 'four five')`;

function mentionOf(row: Row): Mention {
  return { id: row.id, title: row.title, state: row.state, author: { login: row.login } };
}

async function hits(): Promise<Hit[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ ...mentionOf(row), body: row.body, words: row.body.split(" ").length }));
}

async function marked(): Promise<Marked[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ ...row, mark: row.id * 2 }));
}

async function numbered(): Promise<Numbered[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ position: row.id - 1, ...row }));
}

function withoutBody(found: Hit[]): string {
  return JSON.stringify(found.map(({ body, ...hit }) => ({ ...hit, summary: body.slice(0, 7) })));
}

function describe(found: Hit[]): string {
  let text = "";
  for (const hit of found) text += `${hit.id}:${hit.title}:${hit.state}:${hit.author.login}:${hit.body.length}:${hit.words} `;
  return text;
}

const found = await hits();
console.log(describe(found), Object.keys(found[0]!).join(), JSON.stringify(found));
console.log(withoutBody(found));
const all = await marked();
console.log(Object.keys(all[0]!).join(), JSON.stringify(all), all[2]!.mark + all[1]!.id);
const inOrder = await numbered();
console.log(Object.keys(inOrder[0]!).join(), JSON.stringify(inOrder), inOrder[2]!.position);

await db.close();

// GENERATED: hits withoutBody describe
// CHECK-LABEL: function {{*}}name="hits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|Array<undefined|null|[[L_1]]>> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="db"
// CHECK-NEXT: v3 = NewTemplateObject templateStrings=[{cooked="SELECT id, title, state, login, body FROM issues ORDER BY id" raw="SELECT id, title, state, login, body FROM issues ORDER BY id"}]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="db"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]]|Promise flags=[IsExpected]}
// CHECK-NEXT: v6 = Await v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|[[L_4]]> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v8 = PropGet v7 key="map"
// CHECK-NEXT: v9 = NewClosure function=[[f_6]]
// CHECK-NEXT: v10 = Call v8, v7, v9 calleeKey="map" calleeName="map"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object site=[[w_8]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withoutBody"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v0 key="map"
// CHECK-NEXT: v5 = NewClosure function=[[f_11]]
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="map" calleeName="found.map"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|[[L_12]]> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Call v3, v1, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|[[L_1]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = PropGet v10 key="id"
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = String string=":"
// CHECK-NEXT: v14 = PropGet v10 key="title"
// CHECK-NEXT: v15 = ToString v14
// CHECK-NEXT: v16 = String string=":"
// CHECK-NEXT: v17 = PropGet v10 key="state"
// CHECK-NEXT: v18 = ToString v17
// CHECK-NEXT: v19 = String string=":"
// CHECK-NEXT: v20 = PropGet v10 key="author"
// CHECK-NEXT: v21 = PropGet v20 key="login"
// CHECK-NEXT: v22 = ToString v21
// CHECK-NEXT: v23 = String string=":"
// CHECK-NEXT: v24 = PropGet v10 key="body"
// CHECK-NEXT: v25 = PropGet v24 key="length"
// CHECK-NEXT: v26 = Convert v25 declared={type=number site=[[w_19]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = ToString v26
// CHECK-NEXT: v28 = String string=":"
// CHECK-NEXT: v29 = PropGet v10 key="words"
// CHECK-NEXT: v30 = ToString v29
// CHECK-NEXT: v31 = String string=" "
// CHECK-NEXT: v32 = Strcat v12, v13, v15, v16, v18, v19, v22, v23, v27, v28, v30, v31
// CHECK-NEXT: v33 = Add v4, v32
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v34)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v35 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v35
// CHECK-NEXT: }
