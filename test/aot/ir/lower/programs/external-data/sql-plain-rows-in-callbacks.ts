// RUN: lower
// OPTIONS: builtin-modules

// The SQLite adapter of Bun.sql creates plain objects. A callback called with rows of sql<Row[]> converts a plain row that matches Row in place at its entry and runs its typed body; a row that does not match runs the untyped clone.
import { SQL } from "bun";

interface Row {
  id: number;
  parentId: number | null;
  body: string;
  login: string;
}
interface Author {
  login: string;
}
interface Comment {
  id: number;
  parentId: number | null;
  author: Author;
  body: string;
}
interface CommentNode extends Comment {
  replies: CommentNode[];
}

const db = new SQL("sqlite://:memory:");
await db`CREATE TABLE comments (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO comments VALUES (1, NULL, 'first', 'ann'), (2, 1, '', 'bob'), (3, 1, 'naïve — 日本語', 'ann')`;
await db`CREATE TABLE mismatches (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO mismatches VALUES (1, NULL, 'matches', 'ann'), (2, 1, 7, 'bob'), (3, 1, 'no login', NULL)`;

async function commentsOf(): Promise<Comment[]> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM comments ORDER BY id`;
  return rows.map(row => ({ id: row.id, parentId: row.parentId, author: { login: row.login }, body: row.body }));
}

function describe(comments: Comment[]): string {
  let text = "";
  for (const comment of comments) {
    const node: CommentNode = { ...comment, replies: [] };
    text += `${node.id}:${node.parentId}:${node.author.login}:${node.body.length}:${node.replies.length} `;
  }
  return text;
}
console.log(describe(await commentsOf()));

async function inspectMismatches(): Promise<void> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM mismatches ORDER BY id`;
  console.log(rows.map(row => `${row.id}${typeof row.body}${typeof row.login}`).join(), JSON.stringify(rows), Object.keys(rows[0]!).join());
}
await inspectMismatches();

await db.close();
Bun.gc(true);

// GENERATED: commentsOf describe
// CHECK-LABEL: function {{*}}name="commentsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|Array<undefined|null|[[L_1]]>> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="db"
// CHECK-NEXT: v3 = NewTemplateObject templateStrings=[{cooked="SELECT id, parentId, body, login FROM comments ORDER BY id" raw="SELECT id, parentId, body, login FROM comments ORDER BY id"}]
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
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = NewObject layout=[[L_13]]
// CHECK-NEXT: CopyDataProperties v11, v10
// CHECK-NEXT: v13 = Data data=[[d_14]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|[[L_13]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v11, v14 key="replies"
// CHECK-NEXT: v16 = FinishObject v11
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_13]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = PropGet v17 key="id"
// CHECK-NEXT: v19 = ToString v18
// CHECK-NEXT: v20 = String string=":"
// CHECK-NEXT: v21 = PropGet v17 key="parentId"
// CHECK-NEXT: v22 = ToString v21
// CHECK-NEXT: v23 = String string=":"
// CHECK-NEXT: v24 = PropGet v17 key="author"
// CHECK-NEXT: v25 = PropGet v24 key="login"
// CHECK-NEXT: v26 = ToString v25
// CHECK-NEXT: v27 = String string=":"
// CHECK-NEXT: v28 = PropGet v17 key="body"
// CHECK-NEXT: v29 = PropGet v28 key="length"
// CHECK-NEXT: v30 = Convert v29 declared={type=number site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v31 = ToString v30
// CHECK-NEXT: v32 = String string=":"
// CHECK-NEXT: v33 = PropGet v17 key="replies"
// CHECK-NEXT: v34 = PropGet v33 key="length"
// CHECK-NEXT: v35 = Convert v34 declared={type=number site=[[w_17]]} illTypedCause=Assertion
// CHECK-NEXT: v36 = ToString v35
// CHECK-NEXT: v37 = String string=" "
// CHECK-NEXT: v38 = Strcat v19, v20, v22, v23, v26, v27, v31, v32, v36, v37
// CHECK-NEXT: v39 = Add v4, v38
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v40)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v41 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v41
// CHECK-NEXT: }
