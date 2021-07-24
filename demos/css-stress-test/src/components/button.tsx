import React from "react";
import { NewComponent } from "./new-comp";

const Toast = () => {
  const [baconyes, baconno] = useBacon();
  return <div>false</div>;
};
const Button = ({ label, label2, onClick }) => {
  const useCustomHookInsideFunction = (what, arr) => {
    return [true, false];
  };
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    console.log({ on });
  }, [on]);

  // const [foo1, foo2] = useCustomHookInsideFunction(() => {}, [on]);

  return (
    <div className="Button" onClick={onClick}>
      <Toast>f</Toast>
      <div className="Button-label">{label}12</div>
      <NewComponent />
    </div>
  );
};
