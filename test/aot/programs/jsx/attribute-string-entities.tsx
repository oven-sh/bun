// In JSX the string of an attribute is no string of JavaScript: a backslash is a backslash, a line break is allowed, and HTML entities stand for their characters, as they do in the text between tags. A string in braces is JavaScript.
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) { return { tag, props, children } }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const shown = (element: any): void => console.log(JSON.stringify(element.props), JSON.stringify(element.children))
shown(<p title="Tom &amp; Jerry" />)
shown(<p title="&quot;double&quot;" alt='&apos;single&apos;' />)
shown(<p title="&lt;b&gt;" />)
shown(<p title="&copy; 2026 &mdash; &hellip;&nbsp;x" />)
shown(<p title="&#65;&#x42;&#x1F600;" />)
shown(<p title="&unknown; &amp &; & ;" />)
shown(<p title="&amp;amp;" />)
shown(<p title="&AMP; &Aacute; &aacute;" />)
shown(<p title="a\nb\\c" />)
shown(<p title="two
  lines" />)
shown(<p title="" />)
shown(<p title="é ü 漢 😀 &eacute;" />)
shown(<p title={"&amp; in braces"} alt={'&lt;'} />)
shown(<p title={`&amp; in a template`} />)
shown(<p key="&amp;" data-x="&amp;" aria-label="&gt;" />)
shown(<p {...{ a: "&amp;" }} b="&amp;" />)
shown(<p title="&amp;">&amp; between &lt;tags&gt;</p>)
function inside(label: string) { return <input placeholder="Search&hellip;" value={label} name="q&amp;a" /> }
shown(inside("&amp;"))
export {}
