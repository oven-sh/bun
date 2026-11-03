export const stylesheet = `:root { color-scheme: light dark; --line: #d0d7de; --muted: #57606a; --accent: #0969da; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.site { display: flex; gap: 1rem; align-items: center; padding: .75rem 1.5rem; border-bottom: 1px solid var(--line); }
header.site .brand { font-weight: 700; }
header.site .search { flex: 1; }
header.site .search input { width: 100%; max-width: 28rem; padding: .35rem .6rem; }
header.site nav { display: flex; gap: .75rem; align-items: center; }
main { max-width: 72rem; margin: 0 auto; padding: 1.5rem; }
footer { padding: 2rem 1.5rem; color: var(--muted); text-align: center; }
.flash { margin: 0; padding: .6rem 1.5rem; background: #dafbe1; }
.errors { padding: .6rem 1rem .6rem 2rem; border: 1px solid #cf222e; border-radius: 6px; }
.columns { display: grid; grid-template-columns: 1fr 16rem; gap: 2rem; }
.breadcrumb, .meta, .count, .edited, .login { color: var(--muted); }
.tabs a, .sorts a { margin-right: .75rem; }
.selected { font-weight: 700; }
ul.issues, ul.labels, ul.participants, ul.projects, ul.comments, ul.hits { list-style: none; padding: 0; }
ul.issues li, ul.projects li, ul.comments li, ul.hits li { padding: .6rem 0; border-top: 1px solid var(--line); }
.issue .title { font-weight: 600; }
.label { padding: 0 .5rem; border-radius: 1rem; font-size: .8rem; color: #1f2328; }
.state { padding: .15rem .6rem; border-radius: 1rem; color: #fff; }
.state.open { background: #1a7f37; }
.state.closed { background: #8250df; }
.priority-urgent { color: #cf222e; }
.priority-high { color: #bc4c00; }
.comment { margin: 1rem 0; border: 1px solid var(--line); border-radius: 6px; }
.comment > header { padding: .4rem .8rem; border-bottom: 1px solid var(--line); }
.comment > .markdown, .comment > .reply { padding: 0 .8rem; }
.replies { margin-left: 1.25rem; padding-right: .5rem; }
.badge { padding: 0 .4rem; border: 1px solid var(--line); border-radius: 1rem; font-size: .75rem; }
.markdown pre { padding: .75rem; overflow-x: auto; background: #f6f8fa; }
.markdown blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid var(--line); color: var(--muted); }
.pagination { margin-top: 1rem; }
.pagination em { font-style: normal; font-weight: 700; }
form label { display: block; margin: .75rem 0; }
form input:not([type]), form textarea, form select { display: block; width: 100%; padding: .4rem; }
fieldset label { display: inline-block; margin-right: 1rem; }
.button, button { padding: .35rem .9rem; border: 1px solid var(--line); border-radius: 6px; background: #f6f8fa; cursor: pointer; }
table { border-collapse: collapse; }
th, td { padding: .3rem .8rem; border-bottom: 1px solid var(--line); text-align: right; }
th:first-child, td:first-child { text-align: left; }
mark { background: #fff8c5; }
svg.chart rect.opened { fill: #1a7f37; }
svg.chart rect.closed { fill: #8250df; }
`;

export const stylesheetTag = `"${Bun.hash.crc32(stylesheet).toString(16)}"`;
