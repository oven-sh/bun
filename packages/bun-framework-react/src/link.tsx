"use client";

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
      onMouseEnter={e => {
        void router.prefetch(props.href).catch(() => {});
        if (props.onMouseEnter) props.onMouseEnter(e);
      }}
      onClick={async e => {
        if (props.onClick) {
          await (props.onClick(e) as void | Promise<void>);
          if (e.defaultPrevented) return;
        }

        e.preventDefault();
        await router.navigate(props.href, undefined);
      }}
    />
  );
}
