import { RenderCounter } from "./RenderCounter";

export const Button = ({ children }) => {
  return (
    <RenderCounter name="Button">
      <div className="Button">{children}</div>
    </RenderCounter>
  );
};
