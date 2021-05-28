type WelcomeProps = {
  greeting?: string;
};

export function Welcome(props: WelcomeProps) {
  return <div>{props.greeting}</div>;
}
