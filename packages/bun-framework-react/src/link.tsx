import { router } from "../client/constants.ts";

export interface LinkProps extends React.ComponentProps<"a"> {
  /**
   * The URL to navigate to
   */
  href: string;
}

export function Link(props: LinkProps): React.JSX.Element {
  return (
    <a
      {...props}
      onClick={async e => {
        e.preventDefault();
        await router.navigate(props.href, undefined);
      }}
    />
  );
}
