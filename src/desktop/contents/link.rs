//! The answers to the messages of `bun_web::host`.

use bun_ui::protocol::{Reply as System, Request, SystemRequest};
use bun_web::csp::Delivery;
use bun_web::dom;
use bun_web::host::{
    Activation, Answer, Arrival, Browser, Connection, ConsoleAudience, DialogAnswer, DialogKind,
    Display, Environment, FileChoice, Inspected, Keystroke, Notice, Permission, Question,
    Rect as Area, Reply, Verdict,
};
use bun_web::js_link::{Native, NativeHost};
use bun_web::referrer::ReferrerPolicy;
use bun_web::renderer::{Facts, Origins};
use bun_web::trust;
use bun_web::url::Url;

use bun_web::page::News as ForElement;

use super::inspection::{News, with_news};
use super::page::Page;
use super::{Contents, Kind, fields, frame, hooks, load, logs_to_stderr, object_in, or_undefined};

use crate::generated_bindgen::electron::DesktopProcess;
use crate::generated_bindgen::system::js_DesktopNotification;
use crate::prelude::*;
use crate::webview::print;
use crate::{app, dialog, modules, realm, screen, session, task, theme};

fn area(it: Rect) -> Area {
    Area {
        x: it.x.into(),
        y: it.y.into(),
        width: it.width.into(),
        height: it.height.into(),
    }
}

fn page_in(owner: JSValue) -> &'static Page {
    cast(owner).expect("it was made for one")
}

pub(super) fn languages(page: &Page) -> JsResult<Vec<String>> {
    let accepted = page.contents().session.accept_language()?;
    Ok(crate::text::split(&accepted, ",")
        .map(|it| crate::text::before(it, ";").trim().to_owned())
        .collect())
}

fn system_version() -> &'static str {
    if IS_MAC {
        DesktopProcess::get_system_version()
    } else {
        ""
    }
}

fn environment(page: &Page) -> JsResult<Environment> {
    let (it, settings) = (page.contents(), theme::settings()?);
    let window = it.window();
    let bounds = window
        .map(|it| it.bounds())
        .transpose()?
        .unwrap_or_default();
    let (display, emulated) = (screen::display_matching(bounds)?, it.emulated_media());
    let owner = page.owner();
    let seems_focused = owner.inspection.seems_focused.get();
    let seems_shown = seems_focused || it.seems_shown()?;
    let on_device = |real: Area| match owner.device.get().map(|it| it.screen) {
        Some([width, height]) if width * height > 0. => Area {
            x: 0.,
            y: 0.,
            width,
            height,
        },
        _ => real,
    };
    let otherwise = Environment::default();
    Ok(Environment {
        is_dark: emulated.is_dark.map_or_else(theme::is_dark, Ok)?,
        reduces_motion: (emulated.reduces_motion).map_or_else(theme::reduces_motion, Ok)?,
        increases_contrast: (emulated.increases_contrast)
            .map_or_else(theme::increases_contrast, Ok)?,
        forces_colors: (emulated.forces_colors).unwrap_or_else(theme::forces_colors),
        reduces_transparency: (emulated.reduces_transparency)
            .unwrap_or(settings.reduced_transparency),
        light_highlight: (settings.highlight.get()).map_or(otherwise.light_highlight, |it| it[0]),
        dark_highlight: (settings.highlight.get()).map_or(otherwise.dark_highlight, |it| it[1]),
        display: Some(Display {
            bounds: on_device(area(display.bounds)),
            work_area: on_device(area(display.work_area)),
            color_depth: 24,
        }),
        zoom: page.owner().zoom_factor(),
        is_active: seems_focused || it.is_window_focused()?,
        is_visible: seems_shown || !owner.throttles_background.get(),
        is_drawn: seems_shown && (seems_focused || window.is_some()) && !it.is_out_of_sight(),
        is_fullscreen: window.map(|it| it.fills_screen()).transpose()? == Some(true),
        is_transparent: it.kind.get() != Kind::Window || it.preferences.is_transparent,
        overlays_scrollbars: settings
            .overlay_scrollbars
            .get()
            .unwrap_or(otherwise.overlays_scrollbars),
        titlebar_area: fields::view(it)
            .map(|it| it.titlebar_area())
            .transpose()?
            .flatten()
            .map(area),
        window_bounds: Some(area(bounds)),
        languages: languages(page)?,
        fonts: it.preferences.fonts.clone(),
        fixes_text_areas: it.preferences.fixes_text_areas,
        reports_paints: fields::subscriber(it).is_some_and(JSValue::is_callable),
        reports_preferred_size: it.preferences.reports_preferred_size && !it.is_frame(),
        container: it.container(),
    })
}

fn has_spell_checker(page: &Page) -> bool {
    IS_MAC && page.contents().preferences.checks_spelling
}

fn runs_scripts(page: &Page) -> bool {
    page.contents().preferences.runs_scripts && !page.forbids("allow-scripts")
}

fn activation(page: &Page) -> Option<Box<Activation>> {
    page.contents().activation.borrow().clone().map(Box::new)
}

fn arrival(page: &Page) -> Arrival {
    page.loaded().map(|it| it.arrival()).unwrap_or_default()
}

fn refresh(page: &Page) -> Option<String> {
    page.loaded().and_then(|it| it.refresh())
}

pub(super) fn facts(page: &Page) -> Facts {
    let it = page.contents();
    Facts {
        has_spell_checker: has_spell_checker(page),
        is_at_top: same(page, page.owner().page()),
        loads_images: it.preferences.loads_images,
        runs_scripts: runs_scripts(page),
        tab: page.owner().id,
        origins: (!page.is_initial()).then(|| Origins {
            activation: activation(page),
            arrival: arrival(page),
            history: it.entries_for_scripts(),
            inbound_transition: page.inbound_transition.get(),
            refresh: refresh(page),
            restores_scroll: page.restores_scroll.get(),
        }),
    }
}

fn show_dialog(page: &Page, kind: DialogKind, message: String) -> JsResult<DialogAnswer> {
    let (contents, message) = (page.contents(), js(message)?);
    if contents.dismisses_dialogs() || !page.is_active() || page.forbids("allow-modals") {
        return Ok(DialogAnswer::Dismissed);
    }
    if kind == DialogKind::Prompt {
        return Ok(DialogAnswer::Unsupported);
    }
    if contents.preferences.disables_dialogs {
        return Ok(DialogAnswer::Dismissed);
    }
    let buttons = if kind == DialogKind::Confirm {
        vec!["OK", "Cancel"]
    } else {
        vec!["OK"]
    };
    let options =
        object!({ "message": message, "cancelId": buttons.len() as u32 - 1, "buttons": buttons });
    let chosen = invoke(
        dialog::object(),
        "showMessageBoxSync",
        &[contents.window_object(), options],
    )?;
    Ok(if chosen == 0.into() {
        DialogAnswer::Accepted
    } else {
        DialogAnswer::Dismissed
    })
}

fn move_window(page: &Page, bounds: Area) -> JsResult<()> {
    let now = (page.contents().window().map(|it| it.bounds())).transpose()?;
    let display = screen::display_matching(now.unwrap_or_default())?;
    let bounds = bounds.moved_into(area(display.work_area));
    if dispatch(
        page.owner().to_js(),
        "content-bounds-updated",
        &[js(bounds)?],
    )? && let Some(window) = page
        .contents()
        .window()
        .filter(|_| page.contents().kind.get() == Kind::Window)
    {
        invoke(window.to_js(), "setBounds", &[js(bounds)?])?;
    }
    page.contents().environment_changed()
}

fn show_notification(page: &'static Page, id: u32, options: JSValue) -> JsResult<()> {
    let class = js_DesktopNotification::CLASS.constructor(heap());
    let notification = realm::instantiate(class, &[options])?;
    for kind in ["click", "show", "close"] {
        let pass_on = listener(page, move |page, _| {
            page.tell(|it| it.fire_at_notification(id, kind.to_owned()))?;
            if kind == "close" {
                page.notifications()?.remove(global(), js(id)?)?;
            }
            Ok(())
        })?;
        invoke(notification, "on", &[js(kind)?, pass_on])?;
    }
    page.notifications()?.set(global(), js(id)?, notification)?;
    invoke(notification, "show", &[]).map(drop)
}

fn set_fullscreen(page: &Page, is_on: bool) -> JsResult<()> {
    if page.contents().is_apart() {
        return match !is_on || page.owner().context.may_fill_screen.get() {
            true => (page.contents()).tell_element(ForElement::Fullscreen(is_on)),
            false => Ok(()),
        };
    }
    if !page.owner().context.may_fill_screen.take() && is_on {
        return Ok(());
    }
    let name = if is_on {
        "enter-html-full-screen"
    } else {
        "leave-html-full-screen"
    };
    page.later(move |it| announce(it.owner().to_js(), name, &[]));
    let Some(window) = page.contents().window().map(JsInterface::to_js) else {
        return Ok(());
    };
    if !page.contents().preferences.keeps_window_size {
        invoke(window, "setFullScreen", &[is_on.into()])?;
    }
    emit(window, name, &[])
}

pub(super) fn handle_shortcut(page: &Page, key: &Keystroke) -> JsResult<()> {
    let it = page.contents();
    let window = it.window().filter(|_| !it.ignores_menu_shortcuts.get());
    window.map_or(Ok(()), |it| it.handle_shortcut(key))
}

fn pick_files(page: &Page, choice: &FileChoice) -> JsResult<JSValue> {
    let (multiple, directory, accept) = (choice.is_multiple, choice.is_directory, &choice.accept);
    let extensions: Vec<&str> = accept
        .iter()
        .filter_map(|it| it.strip_prefix('.'))
        .collect();
    let filters = match !extensions.is_empty() && extensions.len() == accept.len() {
        true => array(&[object!({ "name": "Custom Files", "extensions": extensions })])?,
        false => array(&[])?,
    };
    let mut properties = vec![if directory {
        "openDirectory"
    } else {
        "openFile"
    }];
    properties.extend(multiple.then_some("multiSelections"));
    let title = match (directory, multiple) {
        (true, _) => "Select Folder to Upload",
        (_, true) => "Open Files",
        _ => "Open File",
    };
    let options = object!({ "title": title, "properties": properties, "filters": filters });
    invoke(
        dialog::object(),
        "showOpenDialog",
        &[page.contents().window_object(), options],
    )
}

/// Whether the windows that the page opens, and the one that has opened it, share objects with it.
pub(super) fn knows_other_windows(page: &Page) -> bool {
    page.has_relatives.get() && trust::relates_windows()
}

fn may_ask_for(page: &Page, permission: &str) -> bool {
    page.is_active()
        && match permission {
            "clipboard-read" if page.is_far() && !page.owner().seems_to_have_focus() => false,
            "clipboard-read" | "fullscreen" => page.has_feature(permission.as_bytes()),
            "clipboard-sanitized-write" => page.has_feature(b"clipboard-write"),
            "notifications" => page.client.is_secure(),
            "pointerLock" => !page.forbids("allow-pointer-lock"),
            _ => false,
        }
}

fn ask_system(request: SystemRequest, reply: Reply<Option<Answer>>) {
    let asked = bun_ui::queue::request(global(), Request::System(request), |global, it| {
        let answer = match it {
            System::Misspelled(words) => Some(Answer::CheckSpelling(words.into_vec())),
            System::Guesses(words) => Some(Answer::GuessSpelling(
                words.iter().map(|it| it.to_string()).collect(),
            )),
            _ => None,
        };
        reply(global, answer);
        Ok(())
    });
    task::report(asked);
}

struct OfTab;

impl Native for OfTab {
    fn hear(&self, _: JSValue, _: Notice) -> JsResult<()> {
        Ok(())
    }

    fn answer(&self, owner: JSValue, question: Question) -> JsResult<Option<Answer>> {
        let page = page_in(owner);
        Ok(Some(match question {
            Question::Browser {} => Answer::Browser(Browser {
                user_agent: page.owner().user_agent()?,
                version: modules::CHROME.to_owned(),
            }),
            Question::Connection {} => Answer::Connection(if session::online::is_online()? {
                Connection::Online
            } else {
                Connection::Offline
            }),
            Question::CountFrames { added } => Answer::CountFrames(page.count_frames(added)),
            Question::Dialog { kind, message, .. } => {
                Answer::Dialog(show_dialog(page, kind, message)?)
            }
            Question::Locale {} => Answer::Locale(Some(app::locale()?.to_owned())),
            Question::Tab {} => Answer::Tab(page.owner().id),
            Question::ReadClipboard { is_selection } => {
                Answer::ReadClipboard(dom::read_clipboard(is_selection))
            }
            Question::WriteClipboard {
                texts,
                is_selection,
            } => {
                dom::write_clipboard(texts, is_selection);
                Answer::WriteClipboard(())
            }
            Question::SystemVersion {} => Answer::SystemVersion(system_version().to_owned()),
            _ => return Ok(None),
        }))
    }

    fn request(&self, owner: JSValue, question: Question, reply: Reply<Option<Answer>>) {
        let page = page_in(owner);
        match question {
            Question::CheckSpelling { text } => {
                ask_system(SystemRequest::CheckSpelling(text.into()), reply);
            }
            Question::GuessSpelling { word } => {
                ask_system(SystemRequest::GuessSpelling(word.into()), reply);
            }
            Question::WriteImage { texts, image } => {
                dom::write_image_to_clipboard(texts, image, Box::new(|| reply(global(), None)));
            }
            Question::Permission { name } if !may_ask_for(page, &name) => {
                reply(global(), Some(Answer::Permission("denied".to_owned())));
            }
            Question::Permission { name } => {
                let (tab, is_for_screen) = (Root::new(page.owner()), name == "fullscreen");
                let (process, permission) = (page.process(), name.clone());
                task::report(page.request_permission(
                    &name,
                    JSValue::UNDEFINED,
                    move |is_granted| {
                        if is_for_screen {
                            tab.get().context.may_fill_screen.set(is_granted);
                        }
                        if let Some(process) = process.filter(|_| is_granted) {
                            process.witness.note_permission(&permission);
                        }
                        let state = if is_granted { "granted" } else { "denied" };
                        reply(global(), Some(Answer::Permission(state.to_owned())));
                        Ok(())
                    },
                ))
            }
            question => reply(
                global(),
                self.answer(owner, question)
                    .map_err(|it| task::report(Err(it)))
                    .ok()
                    .flatten(),
            ),
        }
    }
}

/// What needs no answer, but has to be done at once.
fn obey(page: &'static Page, question: Question) -> JsResult<Option<Answer>> {
    let it = page.contents();
    match question {
        question if page.is_disposed() => return OfTab.answer(page.to_js(), question),
        Question::Activated {} => page.activated()?,
        Question::ActivationConsumed {} => page.consume_activation()?,
        Question::BaseUrlChanged { url } => page.base_url_changed(url),
        Question::CloseWindow { context } => {
            (it.relative(context).into_iter()).for_each(|it| it.close_for(page))
        }
        Question::CreateFrame { frame, owner } if page.has_relatives.get() => {
            frame::create(page, frame, &owner)?
        }
        Question::CreateGuest { frame, scale } if page.place().is_trusted() => {
            hooks::create_guest(page, frame, scale)?
        }
        Question::Disown {} if knows_other_windows(page) => it.set_opened_by(None),
        Question::FocusOther { context } => {
            let may_focus = |it: &&Contents| {
                !it.is_frame()
                    && (page.has_activation() || it.opener_page().is_some_and(|it| same(it, page)))
            };
            match it.relative(context) {
                Some(frame) if frame.is_frame() => frame.tell_element(ForElement::Focus)?,
                other => (other.filter(may_focus)).map_or(Ok(()), |it| it.focus_window())?,
            }
        }
        Question::Frame { frame, message } => frame::obey(page, frame, message)?,
        Question::Guest { frame, message } => hooks::tell_guest(page, frame, message)?,
        Question::Navigate { wish } => hooks::navigate(page, *wish)?,
        Question::Proceed { ticket } => page.proceed(ticket)?,
        Question::StartWindow { context } => {
            let beside = (it.relative(context)).filter(|it| it.page().is_beside(page));
            beside.map(|it| it.started_page()).transpose()?;
        }
        Question::CancelNavigation {} => it.cancel_navigation()?,
        Question::Close {} if knows_other_windows(page) => it.close_for_script(),
        Question::Close {} if !it.is_frame() => it.close_soon(),
        Question::HistoryChanged { entry, change } => it.history_changed(page, entry, change)?,
        Question::Opened {} => page.opened()?,
        Question::Stop {} => {
            page.client.abort_fetches();
            it.stop_loading()?
        }
        Question::Reload {} => page.after_script(|it| it.contents().reload_page(true)),
        Question::Loaded { stage } => it.reached(page, stage)?,
        Question::PaintedInFrame { scale } => it.painted(scale, JSValue::UNDEFINED)?,
        Question::SetFullscreen { is_on } => set_fullscreen(page, is_on)?,
        Question::UnhandledKey { key } => handle_shortcut(page, &key)?,
        Question::SecurityPolicyAdded { policy, is_own } if page.is_far() => {
            let delivery = match is_own {
                true => Delivery::Meta,
                false => Delivery::InjectedMeta,
            };
            page.client.add_csp(policy.as_bytes(), delivery);
        }
        Question::SetName { name } => page.rename(name),
        Question::SetReferrerPolicy { policy } => page
            .client
            .set_referrer_policy(ReferrerPolicy::from_header(policy.as_bytes())),
        Question::SetTitle { title } => it.title_changed(page, title),
        question => return OfTab.answer(page.to_js(), question),
    }
    Ok(None)
}

struct OfWindow;

impl Native for OfWindow {
    fn hear(&self, owner: JSValue, notice: Notice) -> JsResult<()> {
        let page = page_in(owner);
        match notice {
            Notice::Console {
                level,
                message,
                line,
                url,
            } => {
                return page.log_with(&string(level.as_bytes()), &message, line, Some(&url), "");
            }
            Notice::Uncaught {
                message,
                url,
                line,
                stack,
                ..
            } => return page.log_with("error", &message, line, Some(&url), &stack),
            Notice::FirstPaint {} if page.is_at_top() => {
                return announce(page.owner().to_js(), "ready-to-show", &[]);
            }
            Notice::TargetUrlChanged { url } if !page.is_disposed() => {
                return announce(page.owner().to_js(), "update-target-url", &[js(url)?]);
            }
            Notice::IconsChanged { urls } if page.is_at_top() => {
                return announce(page.owner().to_js(), "page-favicon-updated", &[js(urls)?]);
            }
            Notice::ThemeColorChanged { color }
                if page.is_at_top() && page.owner().theme_color.replace(color) != color =>
            {
                let color = color.map(|it| format!("#{:06X}", it >> 8));
                return announce(
                    page.owner().to_js(),
                    "did-change-theme-color",
                    &[js(color)?],
                );
            }
            Notice::CursorChanged { cursor }
                if !page.is_disposed()
                    && has_listeners(page.owner().to_js(), "cursor-changed")? =>
            {
                let name = match &*cursor {
                    "default" => "pointer",
                    "pointer" => "hand",
                    "no-drop" => "nodrop",
                    "all-scroll" => "move",
                    name => name,
                };
                return announce(page.owner().to_js(), "cursor-changed", &[js(name)?]);
            }
            Notice::Painted {} if page.is_at_top() => return page.owner().deliver_frame(),
            Notice::PreferredSizeChanged { width, height } if page.is_at_top() => {
                let size = object!({ "width": width, "height": height });
                return announce(page.owner().to_js(), "preferred-size-changed", &[size]);
            }
            Notice::ContextMenu { mut menu } if !page.is_disposed() => {
                let [left, top] =
                    (page.contents().origin_in_top()).map(|it| it * page.owner().zoom_factor());
                (menu.x, menu.y) = (menu.x + left.round(), menu.y + top.round());
                for url in [&mut menu.link_url, &mut menu.src_url] {
                    if url.starts_with("file:") && page.is_far() && page.origin() != "file://" {
                        "about:blank#blocked".clone_into(url);
                    }
                }
                return hooks::show_context_menu(page, js(menu)?);
            }
            Notice::ShowNotification {
                id,
                title,
                body,
                is_silent,
            } if page.is_active()
                && page.check_permission(js("notifications")?, JSValue::UNDEFINED)? =>
            {
                return show_notification(
                    page,
                    id,
                    object!({ "title": title, "body": body, "silent": is_silent }),
                );
            }
            Notice::CloseNotification { id } => {
                let found = object_in(Some(page.notifications()?.get(global(), js(id)?)?));
                return found.map_or(Ok(()), |it| invoke(it, "close", &[]).map(drop));
            }
            Notice::Crashed {} => {
                return if page.is_disposed() {
                    Ok(())
                } else {
                    page.contents().crash("crashed", 2)
                };
            }
            Notice::FocusWindow {} if page.is_at_top() => return page.contents().focus_window(),
            Notice::MoveWindow { bounds }
                if !page.contents().is_frame() && !page.contents().is_destroyed() =>
            {
                return move_window(page, bounds);
            }
            Notice::Media {
                connection,
                commands,
            } => return page.tell_media(connection, commands),
            Notice::Inspected {
                session,
                method,
                params,
            } if !page.is_disposed() => {
                return page.contents().notify(News::Inspected {
                    session,
                    method: &method,
                    params: &params,
                });
            }
            Notice::Container { message } if page.is_active() => {
                return page.contents().tell_container(message);
            }
            Notice::Post {
                context,
                message,
                target_origin,
            } if !page.is_forgotten.get() => {
                let target = page.contents().relative(context);
                return target.map_or(Ok(()), |it| it.post(page, message, &target_origin));
            }
            Notice::Ping { url, target } if !page.is_disposed() => {
                page.update_agent()?;
                Url::parse(url.as_bytes())
                    .into_iter()
                    .for_each(|it| std::rc::Rc::clone(&page.client).ping(it, target.as_bytes()));
            }
            _ => {}
        }
        Ok(())
    }

    fn answer(&self, owner: JSValue, question: Question) -> JsResult<Option<Answer>> {
        let page = page_in(owner);
        let (it, has_relatives) = (page.contents(), page.has_relatives.get());
        Ok(Some(match question {
            Question::Activation {} => Answer::Activation(activation(page)),
            Question::AllowsFeature { feature } => {
                Answer::AllowsFeature(Some(page.has_feature(feature.as_bytes())))
            }
            Question::ChooseWindow {
                target,
                wish,
                becomes_opener,
            } => Answer::ChooseWindow(hooks::choose_window(
                page,
                &target,
                wish.map(|it| *it),
                becomes_opener,
            )?),
            Question::NavigateWindow { context, wish } => Answer::NavigateWindow(
                (it.relative(context))
                    .map_or(Ok(Verdict::Refused), |it| it.judge_for_script(page, *wish))?,
            ),
            Question::Open {
                wish,
                target,
                features,
                popup,
            } => Answer::Open(hooks::open(page, &wish, &target, &features, popup)?),
            Question::ChecksSpelling {} => {
                Answer::ChecksSpelling(it.session.get_spell_checker_enabled())
            }
            Question::HasWebEngine {} => Answer::HasWebEngine(true),
            Question::HasSpellChecker {} => Answer::HasSpellChecker(has_spell_checker(page)),
            Question::IsLocalFrame { url } => Answer::IsLocalFrame(
                has_relatives
                    && (trust::has_sandbox_for_the_rest() || load::is_trusted_in_frame(&url)?),
            ),
            Question::OriginKey {} => Answer::OriginKey(Some(page.origin_key())),
            Question::AllowsForm { url } => {
                Answer::AllowsForm(Url::parse(url.as_bytes()).map(|url| {
                    let verdict = page.client.policies().csp.check_form_action(&url, None);
                    page.client.enforce(verdict, JSValue::UNDEFINED)
                }))
            }
            Question::AncestorOrigins {} => Answer::AncestorOrigins(
                page.client
                    .ancestors()
                    .iter()
                    .map(|it| string(it.as_bytes()))
                    .collect(),
            ),
            Question::Arrival {} => Answer::Arrival(arrival(page)),
            Question::ConsoleAudience {} => Answer::ConsoleAudience(match it.has_observers() {
                true => ConsoleAudience::Inspector,
                false
                    if logs_to_stderr()
                        || has_listeners(it.owner().to_js(), "console-message")? =>
                {
                    ConsoleAudience::App
                }
                false => ConsoleAudience::Nobody,
            }),
            Question::PermissionState { name, media_type } => {
                let more = or_undefined(
                    media_type
                        .map(|it| JsResult::Ok(object!({ "mediaType": it })))
                        .transpose()?,
                )?;
                Answer::PermissionState(match page.check_permission(js(name)?, more)? {
                    true => Permission::Granted,
                    false => Permission::Denied,
                })
            }
            Question::Origin {} => Answer::Origin(Some(page.origin())),
            Question::Environment {} => Answer::Environment(environment(page)?.into()),
            Question::HistoryEntries {} => Answer::HistoryEntries(it.entries_for_scripts()),
            Question::HistoryLength {} => {
                Answer::HistoryLength(Some(it.history().borrow().entries.len().max(1) as u32))
            }
            Question::InboundTransition {} => {
                Answer::InboundTransition(page.inbound_transition.get())
            }
            Question::IsClosed {} => {
                Answer::IsClosed(knows_other_windows(page) && it.context.is_closed.get())
            }
            Question::IsInitial {} => Answer::IsInitial(page.is_initial()),
            Question::IsBeingLeft {} => {
                Answer::IsBeingLeft(page.contents().loading.is_pending_or_wished())
            }
            Question::IsPopup {} => {
                Answer::IsPopup(trust::relates_windows() && it.owner().context.is_popup.get())
            }
            Question::IsTabFocused {} => Answer::IsTabFocused(it.owner().seems_to_have_focus()),
            Question::IsSandboxed { missing_flag } => {
                Answer::IsSandboxed(page.forbids(&missing_flag))
            }
            Question::MayUnload {} => Answer::MayUnload(Some(it.may_unload(false)?)),
            Question::Name {} => Answer::Name(Some(if page.is_disposed() {
                String::new()
            } else {
                it.context.name.borrow().clone()
            })),
            Question::Refresh {} => Answer::Refresh(refresh(page)),
            Question::CanPrint {} => Answer::CanPrint(!page.forbids("allow-modals")),
            Question::LoadsImages {} => Answer::LoadsImages(Some(it.preferences.loads_images)),
            Question::IsActive {} => Answer::IsActive(Some(page.is_active())),
            Question::RunsScripts {} => Answer::RunsScripts(Some(runs_scripts(page))),
            Question::RestoresScroll {} => Answer::RestoresScroll(page.restores_scroll.get()),
            Question::Traverse { delta } => {
                if page.is_active() {
                    it.owner().traverse_by(delta, page)?;
                }
                Answer::Traverse(true)
            }
            question => return obey(page, question),
        }))
    }

    fn inspect(&self, owner: JSValue, it: Inspected<'_>) -> JsResult<()> {
        with_news(it, &|news| page_in(owner).contents().notify(news))
    }

    fn for_blank_frames(&self) -> Option<&'static dyn Native> {
        Some(&OfTab)
    }

    fn request(&self, owner: JSValue, question: Question, reply: Reply<Option<Answer>>) {
        if let Question::TraverseTo { key } = question {
            return page_in(owner).later(move |it| {
                let outcome = it.contents().traverse_to(&key)?;
                reply(global(), Some(Answer::TraverseTo(outcome)));
                Ok(())
            });
        }
        if !page_in(owner).is_active() {
            return reply(global(), None);
        }
        if let Question::PickFiles { choice } = question {
            let shown = task::outcome(pick_files(page_in(owner), &choice));
            return task::spawn(async {
                let paths = shown.await.map_err(|it| task::throw(&it));
                let paths = paths.and_then(|it| texts_of(get(it.get(), "filePaths")?));
                let paths = task::or_warning(paths);
                let paths = paths.map(|it| it.into_iter().map(bun_web::host::ChosenFile).collect());
                reply(global(), Some(Answer::PickFiles(paths)));
            });
        }
        if let Question::Print {
            markup_of_empty_frame: markup,
        } = &question
        {
            if page_in(owner).forbids("allow-modals") {
                return reply(global(), None);
            }
            let printed = task::outcome(print::print(page_in(owner), markup.clone()));
            return task::spawn(async {
                _ = printed.await;
                reply(global(), None);
            });
        }
        let Question::Microphone {} = question else {
            return OfTab.request(owner, question, reply);
        };
        let page = page_in(owner);
        if !page.has_feature(b"microphone") {
            return reply(global(), None);
        }
        let ask = || {
            let more = object!({ "mediaTypes": ["audio"], "securityOrigin": page.origin() + "/" });
            let asker = Root::new(page);
            page.request_permission("media", more, move |is_granted| {
                asker.get().may_capture.update(|it| it || is_granted);
                let granted = Answer::Microphone(Permission::Granted);
                reply(global(), is_granted.then_some(granted));
                Ok(())
            })
        };
        task::report(ask());
    }
}

struct OfPreload;

impl Native for OfPreload {
    fn hear(&self, owner: JSValue, notice: Notice) -> JsResult<()> {
        match notice {
            Notice::IpcSend {
                channel,
                message,
                has_ports,
            } => page_in(owner).got_message(&channel, message, has_ports),
            Notice::IpcInvoke {
                channel,
                message,
                ticket,
            } => page_in(owner).got_invocation(&channel, &message, ticket),
            notice @ Notice::Crashed {} => OfWindow.hear(owner, notice),
            _ => Ok(()),
        }
    }

    fn answer(&self, owner: JSValue, question: Question) -> JsResult<Option<Answer>> {
        let page = page_in(owner);
        let number = |method| JsResult::Ok(invoke(page.owner().to_js(), method, &[])?.as_number());
        Ok(Some(match question {
            Question::ActivatedByPreload {} => {
                (page.owner().context.last_input).set(bun_web::time::monotonic_now());
                return Ok(None);
            }
            Question::PreloadFailed { file, error } => {
                return page.preload_failed(file, error).map(|()| None);
            }
            Question::Relative { of, relation } => Answer::Relative(page.relative(of, relation)?),
            Question::Zoom {} => Answer::Zoom([number("getZoomFactor")?, number("getZoomLevel")?]),
            Question::SetZoom { value, is_level } => {
                let method = if is_level {
                    "setZoomLevel"
                } else {
                    "setZoomFactor"
                };
                let result = catch(invoke(page.owner().to_js(), method, &[js(value)?]))?;
                Answer::SetZoom(result.err().map(message_of).transpose()?)
            }
            _ => return Ok(None),
        }))
    }

    fn request(&self, owner: JSValue, question: Question, reply: Reply<Option<Answer>>) {
        let Question::IpcSendSync { channel, message } = question else {
            return reply(global(), None);
        };
        let reply = |it| reply(global(), Some(Answer::IpcSendSync(Some(it))));
        task::report(page_in(owner).got_message_to_answer(&channel, &message, reply));
    }
}

pub(super) fn of_preload(page: &Page) -> JSValue {
    NativeHost::create(heap(), &OfPreload, page.to_js())
}

pub(super) fn of_window(page: &Page) -> JSValue {
    NativeHost::create(heap(), &OfWindow, page.to_js())
}
