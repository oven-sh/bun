import { PropsWithChildren } from "react";

export default function Layout({ children }: PropsWithChildren) {
  return (
    <div>
      {children}
      <footer>some rights reserved - {new Date().toString()}</footer>
    </div>
  );
}
