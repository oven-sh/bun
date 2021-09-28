// macro code
export function matchInFile(callExpression: BunAST.CallExpression) {
  const [filePathNode, matcherNode] = callExpression.arguments;
  let filePath: string;
  filePath = filePathNode.get();

  let matcher: RegExp;
  matcher = matcherNode.get();
  const file: string = Bun.readFile(Bun.cwd + filePath);

  return (
    <array>
      {file
        .split("\n")
        .map((line) => line.match(matcher))
        .filter(Boolean)
        .reverse()
        .map((line) => (
          <string value={line[0]} />
        ))}
    </array>
  );
}

export declare namespace BunAST {
  export abstract class ASTNode {
    constructor(...args: any);
  }

  export interface ASTElement<
    P = any,
    T extends string | JSXElementConstructor<any> =
      | string
      | JSXElementConstructor<any>
  > {
    type: T;
    props: P;
    key: Key | null;
  }

  export abstract class Expression extends ASTNode {}

  export abstract class CallExpression extends Expression {
    arguments: AnyExpression[];
    name: string;
    target: AnyExpression;
  }

  export abstract class StringExpression extends Expression {
    get(): string;
    value: string;
  }

  export interface StringExpressionElementProps {
    value: string;
  }

  export type StringExpressionElement = ASTElement<
    StringExpressionElementProps,
    StringExpression
  >;

  export abstract class RegExpExpression extends Expression {
    get(): RegExp;

    flags: string;
    pattern: string;
    raw: string;
  }

  export type AnyExpression =
    | CallExpression
    | StringExpression
    | RegExpExpression;
}

declare global {
  namespace JSX {
    interface Element extends BunAST.ASTElement<any, BunAST.AnyExpression> {}
    interface ElementClass extends BunAST.Expression {}
    interface ElementAttributesProperty {
      props: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }

    // // We can't recurse forever because `type` can't be self-referential;
    // // let's assume it's reasonable to do a single React.lazy() around a single React.memo() / vice-versa
    // type LibraryManagedAttributes<C, P> = C extends React.MemoExoticComponent<infer T> | React.LazyExoticComponent<infer T>
    //     ? T extends React.MemoExoticComponent<infer U> | React.LazyExoticComponent<infer U>
    //         ? ReactManagedAttributes<U, P>
    //         : ReactManagedAttributes<T, P>
    //     : ReactManagedAttributes<C, P>;

    interface IntrinsicElements {
      // HTML
      string: BunAST.StringExpressionElement;
    }
  }
}
