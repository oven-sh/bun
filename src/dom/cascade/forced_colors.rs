//! <https://drafts.csswg.org/css-color-adjust/#forced-colors-mode>

use super::*;
use crate::color::{Color, Rgba, forced};
use crate::svg_values::SvgPaint;

const REVERTED: [Id; 15] = [
    Id::Color,
    Id::BorderTopColor,
    Id::BorderRightColor,
    Id::BorderBottomColor,
    Id::BorderLeftColor,
    Id::OutlineColor,
    Id::ColumnRuleColor,
    Id::RowRuleColor,
    Id::TextDecorationColor,
    Id::TextEmphasisColor,
    Id::CaretColor,
    Id::AccentColor,
    Id::TextFillColor,
    Id::WebkitTextStrokeColor,
    Id::WebkitTapHighlightColor,
];

fn has_url(image: &Image) -> bool {
    match image {
        Image::Url(_) => true,
        Image::Gradient(_) => false,
        Image::Set(options) => options.iter().any(|it| has_url(&it.0)),
        Image::Fade(it) => it.0.iter().flatten().any(has_url),
    }
}

impl Style {
    pub(crate) fn takes_forced_colors(&self) -> bool {
        self.other(Id::ForcedColorAdjust) == "auto"
    }
}

impl Document {
    fn resolve_declared(
        &self,
        id: NodeId,
        rules: &RuleList,
        style: &Style,
        property: Id,
    ) -> Option<(Outcome, Deps)> {
        let (declaration, block) = rules.declaration(
            rules
                .plan(style.flow())
                .longhands
                .iter()
                .find(|it| it.0 == property)?
                .1,
        );
        Some(self.with_context(id, style, style, |cx| {
            (
                self.resolver(id, &style.customs, cx)
                    .resolve(declaration, block),
                cx.deps.get(),
            )
        }))
    }

    /// What `id` would inherit otherwise.
    fn unforced_color(&self, id: NodeId) -> Option<Value> {
        self.tree.flat_ancestors(id).find_map(|it| {
            match self
                .resolve_declared(
                    it,
                    self.tree.element(it)?.rules.as_ref()?,
                    self.tree.style(it)?,
                    Id::Color,
                )?
                .0
            {
                Outcome::Values(values) => values.iter().find(|it| it.id() == Id::Color).cloned(),
                Outcome::Wide(_) => None,
            }
        })
    }

    #[cold]
    pub(super) fn force_colors(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Style,
        adjust: Adjust,
        style: &mut Style,
    ) {
        style.deps |= Deps::PARENT | Deps::INK;
        let inherits_color = |rules, style: &Style| {
            !matches!(
                self.resolve_declared(id, rules, style, Id::Color),
                Some((Outcome::Values(_), _))
            )
        };
        if !style.takes_forced_colors() {
            if style.other(Id::ForcedColorAdjust) == "none"
                && parent.takes_forced_colors()
                && inherits_color(rules, style)
            {
                style.deps |= Deps::ATTRIBUTES;
                self.unforced_color(id)
                    .iter()
                    .for_each(|it| style.groups.set(it));
            }
            return;
        }
        let of_agent = self.styles.intern_all(
            rules
                .matched
                .iter()
                .filter(|it| it.level == Level::UserAgent),
        );
        let keeps = |property, style: &Style| {
            self.resolve_declared(id, rules, style, property)
                .is_some_and(|it| it.1.contains(Deps::SYSTEM_COLOR))
        };
        let keeps_color = keeps(Id::Color, style);
        let plain = if of_agent.matched.len() < rules.matched.len() {
            self.cascade(id, &of_agent, parent, adjust, &[], &[])
        } else {
            style.clone()
        };
        let mut values: SmallVec<[Value; 24]> = REVERTED
            .into_iter()
            .filter(|it| !keeps(*it, style))
            .map(|it| plain.get(it))
            .collect();
        if !keeps(Id::BackgroundColor, style) {
            let [own, usual] =
                [&*style, &plain].map(|it| it.paint.background_color.resolve(it.color()));
            let usual = if usual & 0xff == 0 {
                forced(b"canvas", style.dark)
            } else {
                usual
            };
            values.push(Value::BackgroundColor(Color::Rgba(
                usual & !0xff | own & 0xff,
            )));
        }
        if !style
            .background
            .image
            .0
            .iter()
            .any(|it| it.0.as_ref().is_some_and(has_url))
        {
            values.push(plain.get(Id::BackgroundImage));
        }
        let is_graphic = self
            .tree
            .element(id)
            .is_some_and(|it| it.namespace == Namespace::Svg);
        let of_graphics = [
            Id::Fill,
            Id::Stroke,
            Id::StopColor,
            Id::FloodColor,
            Id::LightingColor,
        ]
        .into_iter()
        .filter(|it| is_graphic && !keeps(*it, style));
        values.extend(of_graphics.filter_map(|it| {
            Some(match style.get(it).typed() {
                Value::Fill(SvgPaint::Color(it)) if it.resolve(0xff) & 0xff != 0 => {
                    Value::Fill(SvgPaint::Color(Color::Current))
                }
                Value::Stroke(SvgPaint::Color(it)) if it.resolve(0xff) & 0xff != 0 => {
                    Value::Stroke(SvgPaint::Color(Color::Current))
                }
                Value::StopColor(_) => Value::StopColor(Color::Current),
                Value::FloodColor(_) => Value::FloodColor(Color::Current),
                Value::LightingColor(_) => Value::LightingColor(Color::Current),
                _ => return None,
            })
        }));
        values.push(Value::ColorScheme(ColorScheme::LIGHT | ColorScheme::DARK));
        values.iter().for_each(|it| style.groups.set(it));
        if !keeps_color && !parent.takes_forced_colors() && inherits_color(&of_agent, style) {
            style.groups.set(&Value::Color(Rgba::plain(forced(
                b"canvastext",
                style.dark,
            ))));
        }
        [Id::BoxShadow, Id::TextShadow, Id::ScrollbarColor]
            .into_iter()
            .for_each(|it| style.groups.set(&self.styles.initial.get(it)));
    }
}
