//! Version 2 of https://learn.microsoft.com/openspecs/windows_protocols/ms-nlmp

use bun_core::strings;
use bun_sha_hmac::hmac;
use bun_sha_hmac::sha::evp::{Algorithm, MD4, MD5};

use super::auth::{Login, Peer, channel_binding};
use crate::time::wall_now;

const SIGNATURE: &[u8] = b"NTLMSSP\0";
const UNICODE: u32 = 1;
/// Also OEM, request target, NTLM, always sign, extended session security and target info.
const FLAGS: u32 = 0x0088_8207;
const AUTHENTICATE_HEADER: usize = 88;

const END_OF_LIST: u16 = 0;
const AV_FLAGS: u16 = 6;
const TIMESTAMP: u16 = 7;
const TARGET_NAME: u16 = 9;
const CHANNEL_BINDINGS: u16 = 10;
const HAS_INTEGRITY_CODE: u32 = 2;

fn security_buffer(length: usize, offset: usize) -> Vec<u8> {
    [
        &(length as u16).to_le_bytes()[..],
        &(length as u16).to_le_bytes(),
        &(offset as u32).to_le_bytes(),
    ]
    .concat()
}

pub(super) fn negotiate_message() -> Vec<u8> {
    [
        SIGNATURE,
        &1u32.to_le_bytes(),
        &FLAGS.to_le_bytes(),
        &security_buffer(0, 40),
        &security_buffer(0, 40),
        &[0; 8],
    ]
    .concat()
}

fn utf16(text: &[u8]) -> Vec<u8> {
    bstr::ByteSlice::to_str_lossy(text)
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn hmac_md5(key: &[u8], parts: &[&[u8]]) -> Option<Vec<u8>> {
    hmac::generate(
        key,
        &parts.concat(),
        Algorithm::Md5,
        &mut [0; hmac::EVP_MAX_MD_SIZE],
    )
    .map(<[u8]>::to_vec)
}

fn pair(id: u16, value: &[u8]) -> Vec<u8> {
    [
        &id.to_le_bytes()[..],
        &(value.len() as u16).to_le_bytes(),
        value,
    ]
    .concat()
}

/// And the time of the server.
fn updated_target_info(mut given: &[u8], peer: &Peer<'_>) -> Option<(Vec<u8>, Option<[u8; 8]>)> {
    let (mut info, mut flags, mut time) = (Vec::new(), HAS_INTEGRITY_CODE, None);
    while let Some((&[a, b, c, d], rest)) = given.split_first_chunk() {
        let (id, (value, rest)) = (
            u16::from_le_bytes([a, b]),
            rest.split_at_checked(u16::from_le_bytes([c, d]).into())?,
        );
        given = rest;
        match id {
            END_OF_LIST => break,
            AV_FLAGS => flags |= u32::from_le_bytes(value.try_into().ok()?),
            TARGET_NAME | CHANNEL_BINDINGS => {}
            _ => info.extend(pair(id, value)),
        }
        if id == TIMESTAMP {
            time = Some(value.try_into().ok()?);
        }
    }
    let mut bindings = [0; 16];
    if !peer.certificate.is_empty() {
        let binding = channel_binding(peer.certificate);
        MD5::hash(
            &[
                &[0; 16][..],
                &(binding.len() as u32).to_le_bytes(),
                &binding,
            ]
            .concat(),
            &mut bindings,
        );
    }
    info.extend(pair(AV_FLAGS, &flags.to_le_bytes()));
    info.extend(pair(CHANNEL_BINDINGS, &bindings));
    info.extend(pair(
        TARGET_NAME,
        &utf16(&[b"HTTP/", peer.hostname].concat()),
    ));
    info.extend(pair(END_OF_LIST, b""));
    Some((info, time))
}

pub(super) fn authenticate_message(
    login: &Login,
    challenge: &[u8],
    peer: &Peer<'_>,
) -> Option<Vec<u8>> {
    const SECONDS_BEFORE_1970: f64 = 11_644_473_600.0;
    let number = |at: usize| Some(u32::from_le_bytes(*challenge.get(at..)?.first_chunk()?));
    (challenge.starts_with(SIGNATURE) && number(8)? == 2).then_some(())?;
    let (flags, server_challenge) = (number(20)? & FLAGS, challenge.get(24..32)?);
    let (info, time) = updated_target_info(
        challenge
            .get(number(44)? as usize..)?
            .get(..(number(40)? & 0xffff) as usize)?,
        peer,
    )?;
    let time =
        time.unwrap_or_else(|| (((wall_now() + SECONDS_BEFORE_1970) * 1e7) as u64).to_le_bytes());
    let (domain, user) = strings::split_once_char(&login.name, b'\\').unwrap_or((b"", &login.name));
    let (mut password_hash, mut client_challenge) = ([0; 16], [0; 8]);
    MD4::hash(&utf16(&login.password), &mut password_hash);
    bun_boringssl_sys::rand_bytes(&mut client_challenge);
    let key = hmac_md5(
        &password_hash,
        &[
            &utf16(
                bstr::ByteSlice::to_str_lossy(user)
                    .to_uppercase()
                    .as_bytes(),
            ),
            &utf16(domain),
        ],
    )?;
    let blob = [
        &[1, 1, 0, 0, 0, 0, 0, 0][..],
        &time,
        &client_challenge,
        &[0; 4],
        &info,
        &[0; 4],
    ]
    .concat();
    let proof = hmac_md5(&key, &[server_challenge, &blob])?;
    let encode = |text: &[u8]| {
        if flags & UNICODE == 0 {
            text.to_vec()
        } else {
            utf16(text)
        }
    };
    let payload = [
        vec![0; 24],
        [&*proof, &blob].concat(),
        encode(domain),
        encode(user),
        Vec::new(),
        Vec::new(),
    ];
    let (mut message, mut offset) = (
        [SIGNATURE, &3u32.to_le_bytes()].concat(),
        AUTHENTICATE_HEADER,
    );
    for part in &payload {
        u16::try_from(part.len()).ok()?;
        message.extend(security_buffer(part.len(), offset));
        offset += part.len();
    }
    message.extend(flags.to_le_bytes());
    message.resize(AUTHENTICATE_HEADER, 0);
    message.extend(payload.concat());
    let code = hmac_md5(
        &hmac_md5(&key, &[&proof])?,
        &[&negotiate_message(), challenge, &message],
    )?;
    message[AUTHENTICATE_HEADER - 16..AUTHENTICATE_HEADER].copy_from_slice(&code);
    Some(message)
}
