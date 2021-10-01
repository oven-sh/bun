import { graphql } from "react-relay";

export const Foo = () => {
  const definition = graphql`
    query FooOperation {
      foo
    }
  `;

  return <div>{definition.operation.name}</div>;
};
